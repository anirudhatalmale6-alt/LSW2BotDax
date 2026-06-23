import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

/**
 * Plugin Manager
 * Handles loading, unloading, and managing plugins for rooms
 */
export class PluginManager {
    constructor(client) {
        this.client = client;
        this.plugins = new Map(); // pluginName -> plugin module
        this.roomPlugins = new Map(); // channelName -> Set of plugin names
        this.pluginInstances = new Map(); // channelName:pluginName -> instance
    }

    /**
     * Load a plugin from a JS file
     * @param {string} pluginPath - Path to the plugin JS file
     * @returns {Promise<object>} The loaded plugin module
     */
    async loadPlugin(pluginPath) {
        const absolutePath = path.resolve(pluginPath);
        
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Plugin file not found: ${absolutePath}`);
        }

        // Use cache-busting to allow hot reloading
        const fileUrl = pathToFileURL(absolutePath).href + `?t=${Date.now()}`;
        const plugin = await import(fileUrl);

        if (!plugin.name) {
            throw new Error(`Plugin must export a 'name' property: ${pluginPath}`);
        }

        this.plugins.set(plugin.name, {
            module: plugin,
            path: absolutePath
        });

        this.client.emit('debug', `Plugin loaded: ${plugin.name}`);
        return plugin;
    }

    /**
     * Load plugins from a directory
     * @param {string} dirPath - Path to the plugins directory
     * @param {string[]} [pluginNames] - Optional list of plugin names to load. If provided, only these plugins will be loaded.
     */
    async loadPluginsFromDirectory(dirPath, pluginNames = null) {
        const absolutePath = path.resolve(dirPath);
        
        if (!fs.existsSync(absolutePath)) {
            fs.mkdirSync(absolutePath, { recursive: true });
            return;
        }

        // If specific plugins are requested, only load those
        const files = pluginNames 
            ? pluginNames.map(name => `${name}.js`)
            : fs.readdirSync(absolutePath).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            try {
                await this.loadPlugin(path.join(absolutePath, file));
            } catch (error) {
                this.client.emit('error', new Error(`Failed to load plugin ${file}: ${error.message}`));
            }
        }
    }

    /**
     * Attach a plugin to a room
     * @param {string} channel - Channel name
     * @param {string} pluginName - Name of the plugin to attach
     */
    attachPluginToRoom(channel, pluginName) {
        const plugin = this.plugins.get(pluginName);
        
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginName}`);
        }

        // Initialize room plugin set if needed
        if (!this.roomPlugins.has(channel)) {
            this.roomPlugins.set(channel, new Set());
        }

        this.roomPlugins.get(channel).add(pluginName);

        // Create plugin instance for this room
        const instanceKey = `${channel}:${pluginName}`;
        const instance = {
            context: {},
            plugin: plugin.module
        };

        this.pluginInstances.set(instanceKey, instance);

        // Call plugin's onAttach if defined
        if (typeof plugin.module.onAttach === 'function') {
            plugin.module.onAttach({
                client: this.client,
                channel,
                context: instance.context
            });
        }

        this.client.emit('debug', `Plugin ${pluginName} attached to ${channel}`);
    }

    /**
     * Detach a plugin from a room
     * @param {string} channel - Channel name
     * @param {string} pluginName - Name of the plugin to detach
     */
    detachPluginFromRoom(channel, pluginName) {
        const roomPlugins = this.roomPlugins.get(channel);
        
        if (!roomPlugins || !roomPlugins.has(pluginName)) {
            return;
        }

        const instanceKey = `${channel}:${pluginName}`;
        const instance = this.pluginInstances.get(instanceKey);

        // Call plugin's onDetach if defined
        if (instance && typeof instance.plugin.onDetach === 'function') {
            instance.plugin.onDetach({
                client: this.client,
                channel,
                context: instance.context
            });
        }

        roomPlugins.delete(pluginName);
        this.pluginInstances.delete(instanceKey);

        this.client.emit('debug', `Plugin ${pluginName} detached from ${channel}`);
    }

    /**
     * Handle a message and route to appropriate plugins
     * @param {object} messageData - Message data from the client
     */
    async handleMessage(messageData) {
        if (messageData.type !== 'channel') {
            return;
        }

        const channel = messageData.channel;
        const roomPlugins = this.roomPlugins.get(channel);

        if (!roomPlugins || roomPlugins.size === 0) {
            return;
        }

        for (const pluginName of roomPlugins) {
            const instanceKey = `${channel}:${pluginName}`;
            const instance = this.pluginInstances.get(instanceKey);

            if (!instance) continue;

            try {
                // Check if plugin has onMessage handler
                if (typeof instance.plugin.onMessage === 'function') {
                    await instance.plugin.onMessage({
                        client: this.client,
                        channel,
                        character: messageData.character,
                        message: messageData.message,
                        context: instance.context,
                        reply: (text) => this.client.sendChannelMessage(channel, text)
                    });
                }

                // Check for command handlers
                if (instance.plugin.commands && messageData.message.startsWith('!')) {
                    const parts = messageData.message.slice(1).split(' ');
                    const commandName = parts[0].toLowerCase();
                    const args = parts.slice(1);

                    const command = instance.plugin.commands[commandName];
                    if (command && typeof command === 'function') {
                        await command({
                            client: this.client,
                            channel,
                            character: messageData.character,
                            args,
                            message: messageData.message,
                            context: instance.context,
                            reply: (text) => this.client.sendChannelMessage(channel, text)
                        });
                    }
                }
            } catch (error) {
                this.client.emit('error', new Error(`Plugin ${pluginName} error: ${error.message}`));
            }
        }
    }

    /**
     * Get list of loaded plugins
     */
    getLoadedPlugins() {
        return Array.from(this.plugins.keys());
    }

    /**
     * Get plugins attached to a room
     */
    getRoomPlugins(channel) {
        const plugins = this.roomPlugins.get(channel);
        return plugins ? Array.from(plugins) : [];
    }

    /**
     * Reload a plugin (hot reload)
     * @param {string} pluginName - Name of the plugin to reload
     */
    async reloadPlugin(pluginName) {
        const plugin = this.plugins.get(pluginName);
        
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginName}`);
        }

        // Find all rooms using this plugin
        const affectedRooms = [];
        for (const [channel, plugins] of this.roomPlugins) {
            if (plugins.has(pluginName)) {
                affectedRooms.push(channel);
            }
        }

        // Detach from all rooms
        for (const channel of affectedRooms) {
            this.detachPluginFromRoom(channel, pluginName);
        }

        // Reload the plugin
        await this.loadPlugin(plugin.path);

        // Reattach to all rooms
        for (const channel of affectedRooms) {
            this.attachPluginToRoom(channel, pluginName);
        }

        this.client.emit('debug', `Plugin ${pluginName} reloaded`);
    }
}

export default PluginManager;
