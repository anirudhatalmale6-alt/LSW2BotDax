import WebSocket from 'ws';
import EventEmitter from 'events';

const FLIST_ENDPOINT = 'wss://chat.f-list.net/chat2';
const FLIST_AUTH_URL = 'https://www.f-list.net/json/getApiTicket.php';

/**
 * F-list Bot Client
 * Handles connection to F-list chat and message routing
 */
export class FListClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.username = options.username;
        this.password = options.password;
        this.botName = options.botName;
        this.ws = null;
        this.ticket = null;
        this.connected = false;
        this.joinedRooms = new Set();
        this.pingInterval = null;
    }

    /**
     * Get authentication ticket from F-list
     */
    async getTicket() {
        const params = new URLSearchParams();
        params.append('account', this.username);
        params.append('password', this.password);
        params.append('no_characters', 'true');
        params.append('no_friends', 'true');
        params.append('no_bookmarks', 'true');

        const response = await fetch(FLIST_AUTH_URL, {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const data = await response.json();
        
        if (data.error && data.error !== '') {
            throw new Error(`Authentication failed: ${data.error}`);
        }

        this.ticket = data.ticket;
        return this.ticket;
    }

    /**
     * Connect to F-list chat server
     */
    async connect() {
        if (!this.ticket) {
            await this.getTicket();
        }

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(FLIST_ENDPOINT);

            this.ws.on('open', () => {
                this.emit('debug', 'WebSocket connected, identifying...');
                this.send('IDN', {
                    method: 'ticket',
                    account: this.username,
                    ticket: this.ticket,
                    character: this.botName,
                    cname: 'FList Bot Library',
                    cversion: '1.0.0'
                });
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('close', (code, reason) => {
                this.connected = false;
                this.stopPing();
                this.emit('disconnected', { code, reason: reason.toString() });
            });

            this.ws.on('error', (error) => {
                this.emit('error', error);
                reject(error);
            });

            // Set up identification success handler
            const onIdentified = () => {
                this.removeListener('identified', onIdentified);
                resolve();
            };
            this.on('identified', onIdentified);

            // Timeout for connection
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Connection timeout'));
                }
            }, 30000);
        });
    }

    /**
     * Handle incoming messages from F-list
     */
    handleMessage(raw) {
        const command = raw.substring(0, 3);
        let data = {};

        if (raw.length > 4) {
            try {
                data = JSON.parse(raw.substring(4));
            } catch (e) {
                this.emit('debug', `Failed to parse message: ${raw}`);
            }
        }

        this.emit('raw', { command, data });

        switch (command) {
            case 'IDN':
                this.connected = true;
                this.startPing();
                this.emit('identified');
                this.emit('debug', `Identified as ${this.botName}`);
                break;

            case 'PIN':
                this.send('PIN');
                break;

            case 'MSG':
                // Channel message
                this.emit('message', {
                    type: 'channel',
                    channel: data.channel,
                    character: data.character,
                    message: data.message
                });
                break;

            case 'PRI':
                // Private message
                this.emit('message', {
                    type: 'private',
                    character: data.character,
                    message: data.message
                });
                break;

            case 'JCH':
                // Someone joined a channel (including us)
                if (data.character?.identity === this.botName) {
                    this.joinedRooms.add(data.channel);
                    this.emit('joinedChannel', { channel: data.channel, title: data.title });
                }
                this.emit('userJoined', {
                    channel: data.channel,
                    character: data.character?.identity
                });
                break;

            case 'LCH':
                // Someone left a channel
                if (data.character === this.botName) {
                    this.joinedRooms.delete(data.channel);
                    this.emit('leftChannel', { channel: data.channel });
                }
                this.emit('userLeft', {
                    channel: data.channel,
                    character: data.character
                });
                break;

            case 'ICH':
                // Initial channel data
                this.emit('channelData', data);
                break;

            case 'ERR':
                this.emit('error', new Error(`Server error: ${data.message} (${data.number})`));
                break;

            case 'CON':
                this.emit('debug', `Connected users: ${data.count}`);
                break;

            case 'VAR':
                this.emit('serverVariable', data);
                break;

            default:
                this.emit('unknownCommand', { command, data });
        }
    }

    /**
     * Send a command to F-list
     */
    send(command, data = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.emit('error', new Error('WebSocket is not connected'));
            return;
        }

        let message = command;
        if (data) {
            message += ' ' + JSON.stringify(data);
        }

        this.ws.send(message);
        this.emit('debug', `Sent: ${message}`);
    }

    /**
     * Join a channel
     */
    joinChannel(channel) {
        this.send('JCH', { channel });
    }

    /**
     * Leave a channel
     */
    leaveChannel(channel) {
        this.send('LCH', { channel });
    }

    /**
     * Send a message to a channel
     */
    sendChannelMessage(channel, message) {
        this.send('MSG', { channel, message });
    }

    /**
     * Send a private message
     */
    sendPrivateMessage(recipient, message) {
        this.send('PRI', { recipient, message });
    }

    /**
     * Start ping interval to keep connection alive
     */
    startPing() {
        this.pingInterval = setInterval(() => {
            if (this.connected) {
                this.send('PIN');
            }
        }, 45000); // Ping every 45 seconds
    }

    /**
     * Stop ping interval
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Disconnect from F-list
     */
    disconnect() {
        this.stopPing();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}

export default FListClient;
