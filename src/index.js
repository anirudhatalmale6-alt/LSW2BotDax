import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FListClient } from './client.js';
import { PluginManager } from './pluginManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

/**
 * F-list Bot
 * Main entry point that ties together the client and plugin system
 */
export class FListBot {
    constructor(options = {}) {
        this.client = new FListClient({
            username: options.username || process.env.FLIST_USERNAME,
            password: options.password || process.env.FLIST_PASSWORD,
            botName: options.botName || process.env.FLIST_BOT_NAME
        });

        this.pluginManager = new PluginManager(this.client);
        this.config = null;
        this.debug = options.debug || false;

        this.setupEventHandlers();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Route messages to plugin manager
        this.client.on('message', (data) => {
            this.pluginManager.handleMessage(data);
        });

        // Debug logging
        if (this.debug) {
            this.client.on('debug', (msg) => console.log(`[DEBUG] ${msg}`));
        }

        // Error logging
        this.client.on('error', (error) => {
            console.error(`[ERROR] ${error.message}`);
        });

        // Connection events
        this.client.on('identified', () => {
            console.log(`[BOT] Connected as ${this.client.botName}`);
            this.joinConfiguredRooms();
        });

        this.client.on('disconnected', ({ code, reason }) => {
            console.log(`[BOT] Disconnected: ${code} - ${reason}`);
        });

        this.client.on('joinedChannel', ({ channel, title }) => {
            console.log(`[BOT] Joined channel: ${title || channel}`);
            this.attachPluginsToRoom(channel);
        });

        this.client.on('leftChannel', ({ channel }) => {
            console.log(`[BOT] Left channel: ${channel}`);
        });
    }

    /**
     * Load configuration from config.json
     */
    loadConfig(configPath = CONFIG_PATH) {
        if (!fs.existsSync(configPath)) {
            console.warn('[BOT] No config.json found, using defaults');
            this.config = { pluginsDirectory: './plugins', rooms: [] };
            return;
        }

        const configContent = fs.readFileSync(configPath, 'utf-8');
        this.config = JSON.parse(configContent);
    }

    /**
     * Load plugins based on configuration
     */
    async loadPlugins() {
        const pluginsDir = path.resolve(
            path.dirname(CONFIG_PATH),
            this.config.pluginsDirectory || './plugins'
        );

        // Extract unique plugin names from room configurations
        const requiredPlugins = new Set();
        if (this.config.rooms) {
            for (const room of this.config.rooms) {
                if (room.plugins) {
                    room.plugins.forEach(p => requiredPlugins.add(p));
                }
            }
        }

        await this.pluginManager.loadPluginsFromDirectory(pluginsDir, Array.from(requiredPlugins));
        console.log(`[BOT] Loaded plugins: ${this.pluginManager.getLoadedPlugins().join(', ') || 'none'}`);
    }

    /**
     * Join rooms from configuration
     */
    joinConfiguredRooms() {
        if (!this.config || !this.config.rooms) return;

        for (const room of this.config.rooms) {
            console.log(`[BOT] Joining room: ${room.channel}`);
            this.client.joinChannel(room.channel);
        }
    }

    /**
     * Attach plugins to a room based on configuration
     */
    attachPluginsToRoom(channel) {
        if (!this.config || !this.config.rooms) return;

        // Case-insensitive comparison (F-list returns uppercase channel IDs)
        const roomConfig = this.config.rooms.find(r => r.channel.toLowerCase() === channel.toLowerCase());
        if (!roomConfig || !roomConfig.plugins) return;

        for (const pluginName of roomConfig.plugins) {
            try {
                this.pluginManager.attachPluginToRoom(channel, pluginName);
            } catch (error) {
                console.error(`[BOT] Failed to attach plugin ${pluginName} to ${channel}: ${error.message}`);
            }
        }
    }

    /**
     * Start the bot
     */
    async start() {
        console.log('[BOT] Starting F-list Bot...');

        // Load configuration
        this.loadConfig();

        // Load plugins
        await this.loadPlugins();

        // Connect to F-list
        try {
            await this.client.connect();
        } catch (error) {
            console.error(`[BOT] Failed to connect: ${error.message}`);
            throw error;
        }
    }

    /**
     * Stop the bot
     */
    stop() {
        console.log('[BOT] Stopping F-list Bot...');
        this.client.disconnect();
    }
}

// Export for library use
export { FListClient } from './client.js';
export { PluginManager } from './pluginManager.js';

// Run if executed directly
const isMainModule = process.argv[1] && 
    (process.argv[1].endsWith('index.js') || process.argv[1].includes('F-list Bot'));

if (isMainModule) {
    const bot = new FListBot({ debug: true });

    // Graceful shutdown
    process.on('SIGINT', () => {
        bot.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        bot.stop();
        process.exit(0);
    });

    bot.start().catch((error) => {
        console.error('Failed to start bot:', error);
        process.exit(1);
    });
}

export default FListBot;
