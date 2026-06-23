# F-list Bot Library

A simple bot-handling library for F-list chat with a plugin system.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your credentials in `.env`:
   ```env
   FLIST_USERNAME=your_account_username
   FLIST_PASSWORD=your_account_password
   FLIST_BOT_NAME=your_bot_character_name
   ```

3. Configure rooms and plugins in `config.json`:
   ```json
   {
     "pluginsDirectory": "./plugins",
     "rooms": [
       {
         "channel": "ADH-your-room-id",
         "plugins": ["example"]
       }
     ]
   }
   ```

   > **Note:** Private room IDs start with `ADH-` followed by a unique identifier. Public rooms use their exact channel name.

4. Run the bot:
   ```bash
   npm start
   ```

   Or with file watching (auto-restart on changes):
   ```bash
   npm run dev
   ```

## Creating Plugins

Plugins are JavaScript ES modules placed in the `plugins/` directory. Each plugin must export a `name` property and can optionally export handlers.

### Plugin Structure

```javascript
// plugins/my-plugin.js

// Required: Plugin name (must be unique)
export const name = 'my-plugin';

// Optional: Description and version
export const description = 'My awesome plugin';
export const version = '1.0.0';

// Called when plugin is attached to a room
export function onAttach({ client, channel, context }) {
    console.log(`Plugin attached to ${channel}`);
    context.myData = {}; // Store data in context
}

// Called when plugin is detached from a room
export function onDetach({ client, channel, context }) {
    console.log(`Plugin detached from ${channel}`);
}

// Called for every message in the room
export function onMessage({ client, channel, character, message, context, reply }) {
    // Process message
    if (message.toLowerCase().includes('hello')) {
        reply(`Hello, ${character}!`);
    }
}

// Command handlers (messages starting with !)
export const commands = {
    // !mycommand <args>
    mycommand: ({ args, character, reply }) => {
        reply(`You said: ${args.join(' ')}`);
    }
};
```

### Handler Parameters

All handlers receive an object with these properties:

| Property | Description |
|----------|-------------|
| `client` | The FListClient instance for direct API access |
| `channel` | The channel name this plugin is attached to |
| `context` | A per-room object for storing plugin state |
| `reply` | Shortcut function to send a message to the channel |

Message handlers additionally receive:
| Property | Description |
|----------|-------------|
| `character` | The character who sent the message |
| `message` | The message content |
| `args` | (commands only) Array of arguments after the command |

## Using as a Library

You can also use this as a library in your own project:

```javascript
import { FListBot, FListClient, PluginManager } from 'flist-bot';

// Simple usage
const bot = new FListBot({
    username: 'myaccount',
    password: 'mypassword',
    botName: 'MyBotCharacter',
    debug: true
});

await bot.start();

// Or use the client directly for custom implementations
const client = new FListClient({
    username: 'myaccount',
    password: 'mypassword',
    botName: 'MyBotCharacter'
});

client.on('message', (data) => {
    console.log(`${data.character}: ${data.message}`);
});

await client.connect();
client.joinChannel('ADH-my-room');
```

## Client Events

| Event | Description |
|-------|-------------|
| `identified` | Successfully connected and identified |
| `disconnected` | Disconnected from server |
| `message` | Received a channel or private message |
| `joinedChannel` | Bot joined a channel |
| `leftChannel` | Bot left a channel |
| `userJoined` | A user joined a channel |
| `userLeft` | A user left a channel |
| `error` | An error occurred |
| `debug` | Debug information |

## Client Methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to F-list chat |
| `disconnect()` | Disconnect from chat |
| `joinChannel(channel)` | Join a channel |
| `leaveChannel(channel)` | Leave a channel |
| `sendChannelMessage(channel, message)` | Send a message to a channel |
| `sendPrivateMessage(recipient, message)` | Send a private message |

## License

MIT
