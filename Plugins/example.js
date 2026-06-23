/**
 * Example Plugin
 * Demonstrates the plugin structure and available features
 */

// Plugin name (required) - must be unique
export const name = 'example';

// Plugin description (optional)
export const description = 'An example plugin demonstrating bot features';

// Plugin version (optional)
export const version = '1.0.0';

/**
 * Called when the plugin is attached to a room
 * Use this for initialization
 */
export function onAttach({ client, channel, context }) {
    console.log(`[${name}] Attached to ${channel}`);
    
    // You can store data in context that persists for this room
    context.messageCount = 0;
}

/**
 * Called when the plugin is detached from a room
 * Use this for cleanup
 */
export function onDetach({ client, channel, context }) {
    console.log(`[${name}] Detached from ${channel}. Total messages seen: ${context.messageCount}`);
}

/**
 * Called for every message in the room
 * Use this for general message processing
 */
export function onMessage({ client, channel, character, message, context, reply }) {
    // Track message count
    context.messageCount++;
    
    // Example: respond to greetings
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('hello bot') || lowerMessage.includes('hi bot')) {
        reply(`Hello, ${character}! 👋`);
    }
}

/**
 * Command handlers
 * These are called when a message starts with !commandname
 * The key is the command name (without the !)
 */
export const commands = {
    /**
     * !ping - Simple ping command
     */
    ping: ({ reply }) => {
        reply('Pong! 🏓');
    },

    /**
     * !echo <text> - Echo back the provided text
     */
    echo: ({ args, reply }) => {
        if (args.length === 0) {
            reply('Usage: !echo <text>');
            return;
        }
        reply(args.join(' '));
    },

    /**
     * !roll <dice> - Roll dice (e.g., !roll 2d6)
     */
    roll: ({ args, character, reply }) => {
        const dicePattern = /^(\d+)?d(\d+)$/i;
        const input = args[0] || '1d6';
        const match = input.match(dicePattern);

        if (!match) {
            reply('Usage: !roll [count]d<sides> (e.g., !roll 2d6)');
            return;
        }

        const count = parseInt(match[1] || '1', 10);
        const sides = parseInt(match[2], 10);

        if (count < 1 || count > 20 || sides < 2 || sides > 100) {
            reply('Please use 1-20 dice with 2-100 sides.');
            return;
        }

        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }

        const total = rolls.reduce((a, b) => a + b, 0);
        reply(`${character} rolled ${input}: [${rolls.join(', ')}] = ${total}`);
    },

    /**
     * !stats - Show message statistics for this room
     */
    stats: ({ context, reply }) => {
        reply(`Messages seen since plugin loaded: ${context.messageCount}`);
    },

    /**
     * !help - Show available commands
     */
    help: ({ reply }) => {
        reply('Available commands: !ping, !echo <text>, !roll [count]d<sides>, !stats, !help');
    }
};
