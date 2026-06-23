/**
 * LSW (Lewd Stat Wars) Plugin
 * A turn-based battle game for F-list chat rooms
 */

import { MongoClient } from 'mongodb';

// Plugin metadata
export const name = 'lsw';
export const description = 'Lewd Stat Wars - A turn-based battle game';
export const version = '1.0.0';

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = 'flist_bot';
const COLLECTION_NAME = 'lsw';

let mongoClient = null;
let db = null;

/**
 * Connect to MongoDB
 */
async function connectDB() {
    if (!mongoClient) {
        mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
        db = mongoClient.db(DB_NAME);
        console.log(`[${name}] Connected to MongoDB`);
    }
    return db;
}

/**
 * Get the players collection
 */
async function getPlayersCollection() {
    const database = await connectDB();
    return database.collection(COLLECTION_NAME);
}

/**
 * Roll dice (e.g., 2d6)
 */
function rollDice(count, sides) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * sides) + 1;
    }
    return total;
}

/**
 * Create HP bar visualization
 */
function createHPBar(current, max, length = 10) {
    const filled = Math.round((current / max) * length);
    const empty = length - filled;
    const filledBar = '█'.repeat(Math.max(0, filled));
    const emptyBar = '█'.repeat(Math.max(0, empty));
    return `[color=pink]${filledBar}[/color][color=gray]${emptyBar}[/color]`;
}

/**
 * Get player from database
 */
async function getPlayer(username) {
    const collection = await getPlayersCollection();
    return await collection.findOne({ username: username.toLowerCase() });
}

/**
 * Create new player
 */
async function createPlayer(username) {
    const collection = await getPlayersCollection();
    const player = {
        username: username.toLowerCase(),
        displayName: username,
        lipsAttack: 1,
        fingersAttack: 1,
        chestAttack: 1,
        bodyAttack: 1,
        feetAttack: 1,
        lipsDefense: 1,
        fingersDefense: 1,
        chestDefense: 1,
        bodyDefense: 1,
        feetDefense: 1,
        trainingPoints: 15,
        createdAt: new Date()
    };
    await collection.insertOne(player);
    return player;
}

/**
 * Update player stats
 */
async function updatePlayer(username, updates) {
    const collection = await getPlayersCollection();
    await collection.updateOne(
        { username: username.toLowerCase() },
        { $set: updates }
    );
}

/**
 * Format player stats for display
 */
function formatStats(player) {
    return `[b]Stats for ${player.displayName}[/b]
[b]Attack:[/b] Lips: ${player.lipsAttack} | Fingers: ${player.fingersAttack} | Chest: ${player.chestAttack} | Body: ${player.bodyAttack} | Feet: ${player.feetAttack}
[b]Defense:[/b] Lips: ${player.lipsDefense} | Fingers: ${player.fingersDefense} | Chest: ${player.chestDefense} | Body: ${player.bodyDefense} | Feet: ${player.feetDefense}
[b]Training Points:[/b] ${player.trainingPoints}`;
}

/**
 * Format battle status
 */
function formatBattleStatus(gameState, attackMessage = null) {
    const p1 = gameState.player1;
    const p2 = gameState.player2;
    const p1Bar = createHPBar(p1.hp, 50);
    const p2Bar = createHPBar(p2.hp, 50);
    const currentTurn = gameState.currentTurn === 1 ? p1.displayName : p2.displayName;
    
    let status = '';
    if (attackMessage) {
        status += `${attackMessage}\n`;
    }
    status += `${p1Bar}    ${p2Bar}
[icon]${p1.displayName}[/icon] HP: ${p1.hp}/50 vs [icon]${p2.displayName}[/icon] HP: ${p2.hp}/50
It's ${currentTurn}'s turn!`;
    
    return status;
}

/**
 * Called when the plugin is attached to a room
 */
export function onAttach({ client, channel, context }) {
    console.log(`[${name}] Attached to ${channel}`);
    
    // Initialize game state for this room
    context.gameState = null;
    context.readyPlayer = null;
    
    // Connect to database
    connectDB().catch(err => {
        console.error(`[${name}] Failed to connect to MongoDB:`, err);
    });
}

/**
 * Called when the plugin is detached from a room
 */
export function onDetach({ client, channel, context }) {
    console.log(`[${name}] Detached from ${channel}`);
}

/**
 * Command handlers
 */
export const commands = {
    /**
     * !register - Register a new player
     */
    register: async ({ character, reply }) => {
        try {
            const existingPlayer = await getPlayer(character);
            
            if (existingPlayer) {
                reply(`${character}, you are already registered! Use !stats to see your stats.`);
                return;
            }
            
            const player = await createPlayer(character);
            reply(`Welcome to LSW, ${character}! You have been registered with 15 training points to distribute.
Use [b]!train <attack/defense> on <part>[/b] to increase a stat (costs 1 training point).
Use [b]!stats[/b] to view your current stats.
Parts: lips, fingers, chest, body, feet`);
        } catch (error) {
            console.error(`[${name}] Register error:`, error);
            reply('An error occurred during registration. Please try again later.');
        }
    },

    /**
     * !train <attack/defense> on <part> - Train a stat
     */
    train: async ({ character, args, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !register first!`);
                return;
            }
            
            // Parse: attack/defense on part
            const argsStr = args.join(' ').toLowerCase();
            const match = argsStr.match(/^(attack|defense)\s+on\s+(lips|fingers|chest|body|feet)$/);
            
            if (!match) {
                reply('Usage: !train <attack/defense> on <part>\nParts: lips, fingers, chest, body, feet');
                return;
            }
            
            const [, type, part] = match;
            const statKey = `${part}${type.charAt(0).toUpperCase() + type.slice(1)}`;
            
            if (player.trainingPoints <= 0) {
                reply(`${character}, you have no training points left!`);
                return;
            }
            
            if (player[statKey] >= 5) {
                reply(`${character}, your ${part} ${type} is already at maximum (5)!`);
                return;
            }
            
            // Update the stat
            const updates = {
                [statKey]: player[statKey] + 1,
                trainingPoints: player.trainingPoints - 1
            };
            await updatePlayer(character, updates);
            
            reply(`${character} trained their ${part} ${type}! ${player[statKey]} → ${player[statKey] + 1} (${player.trainingPoints - 1} training points remaining)`);
        } catch (error) {
            console.error(`[${name}] Train error:`, error);
            reply('An error occurred while training. Please try again later.');
        }
    },

    /**
     * !indulge <attack/defense> on <part> - Decrease a stat to regain training points
     */
    indulge: async ({ character, args, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !register first!`);
                return;
            }
            
            // Parse: attack/defense on part
            const argsStr = args.join(' ').toLowerCase();
            const match = argsStr.match(/^(attack|defense)\s+on\s+(lips|fingers|chest|body|feet)$/);
            
            if (!match) {
                reply('Usage: !indulge <attack/defense> on <part>\nParts: lips, fingers, chest, body, feet');
                return;
            }
            
            const [, type, part] = match;
            const statKey = `${part}${type.charAt(0).toUpperCase() + type.slice(1)}`;
            
            if (player[statKey] <= 1) {
                reply(`${character}, your ${part} ${type} is already at minimum (1)!`);
                return;
            }
            
            // Update the stat
            const updates = {
                [statKey]: player[statKey] - 1,
                trainingPoints: player.trainingPoints + 1
            };
            await updatePlayer(character, updates);
            
            reply(`${character} indulged their ${part} ${type}! ${player[statKey]} → ${player[statKey] - 1} (${player.trainingPoints + 1} training points remaining)`);
        } catch (error) {
            console.error(`[${name}] Indulge error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !stats - Show player stats
     */
    stats: async ({ character, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !register first!`);
                return;
            }
            
            reply(formatStats(player));
        } catch (error) {
            console.error(`[${name}] Stats error:`, error);
            reply('An error occurred while fetching stats. Please try again later.');
        }
    },

    /**
     * !ready - Set player as ready for battle
     */
    ready: async ({ character, context, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !register first!`);
                return;
            }
            
            // Check if there's already an active battle
            if (context.gameState) {
                reply('A battle is already in progress! Wait for it to finish or use !endbattle.');
                return;
            }
            
            // Check if this player is already ready
            if (context.readyPlayer && context.readyPlayer.username === player.username) {
                reply(`${character}, you're already ready! Waiting for an opponent...`);
                return;
            }
            
            // If no one is ready, set this player as ready
            if (!context.readyPlayer) {
                context.readyPlayer = {
                    username: player.username,
                    displayName: player.displayName,
                    lipsAttack: player.lipsAttack,
                    fingersAttack: player.fingersAttack,
                    chestAttack: player.chestAttack,
                    bodyAttack: player.bodyAttack,
                    feetAttack: player.feetAttack,
                    lipsDefense: player.lipsDefense,
                    fingersDefense: player.fingersDefense,
                    chestDefense: player.chestDefense,
                    bodyDefense: player.bodyDefense,
                    feetDefense: player.feetDefense,
                    hp: 50
                };
                reply(`[icon]${character}[/icon] is ready for battle! Another player, use !ready to begin!`);
                return;
            }
            
            // Second player ready - start the battle!
            const player2 = {
                username: player.username,
                displayName: player.displayName,
                lipsAttack: player.lipsAttack,
                fingersAttack: player.fingersAttack,
                chestAttack: player.chestAttack,
                bodyAttack: player.bodyAttack,
                feetAttack: player.feetAttack,
                lipsDefense: player.lipsDefense,
                fingersDefense: player.fingersDefense,
                chestDefense: player.chestDefense,
                bodyDefense: player.bodyDefense,
                feetDefense: player.feetDefense,
                hp: 50
            };
            
            context.gameState = {
                player1: context.readyPlayer,
                player2: player2,
                currentTurn: 1 // Player 1 goes first
            };
            context.readyPlayer = null;
            
            const p1 = context.gameState.player1;
            const p2 = context.gameState.player2;
            
            reply(`[b]⚔️ BATTLE START! ⚔️[/b]
[icon]${p1.displayName}[/icon] vs [icon]${p2.displayName}[/icon]

${formatBattleStatus(context.gameState)}

Use [b]!attack <your part> to <their part>[/b] to attack!`);
        } catch (error) {
            console.error(`[${name}] Ready error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !attack <part> to <part> - Attack in battle
     */
    attack: async ({ character, args, context, reply }) => {
        try {
            if (!context.gameState) {
                reply('No battle is currently in progress! Use !ready to start one.');
                return;
            }
            
            const gs = context.gameState;
            const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
            const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();
            
            if (!isPlayer1 && !isPlayer2) {
                reply(`${character}, you're not in this battle!`);
                return;
            }
            
            // Check if it's this player's turn
            const isTheirTurn = (gs.currentTurn === 1 && isPlayer1) || (gs.currentTurn === 2 && isPlayer2);
            if (!isTheirTurn) {
                reply(`${character}, it's not your turn!`);
                return;
            }
            
            // Parse: part to part
            const argsStr = args.join(' ').toLowerCase();
            const match = argsStr.match(/^(lips|fingers|chest|body|feet)\s+to\s+(lips|fingers|chest|body|feet)$/);
            
            if (!match) {
                reply('Usage: !attack <your part> to <their part>\nParts: lips, fingers, chest, body, feet');
                return;
            }
            
            const [, attackPart, defendPart] = match;
            
            const attacker = gs.currentTurn === 1 ? gs.player1 : gs.player2;
            const defender = gs.currentTurn === 1 ? gs.player2 : gs.player1;
            
            // Get attack and defense stats
            const attackStatKey = `${attackPart}Attack`;
            const defenseStatKey = `${defendPart}Defense`;
            
            const attackStat = attacker[attackStatKey];
            const defenseStat = defender[defenseStatKey];
            
            // Calculate damage: attack - defense + 2d6, minimum 1
            const diceRoll = rollDice(2, 6);
            let damage = attackStat - defenseStat + diceRoll;
            if (damage <= 0) damage = 1;
            
            // Apply damage
            defender.hp -= damage;
            if (defender.hp < 0) defender.hp = 0;
            
            const attackMessage = `[b]${attacker.displayName}[/b] used their [b]${attackPart}[/b] to attack [b]${defender.displayName}[/b]'s [b]${defendPart}[/b], dealing [b]${damage}[/b] damage! (${attackStat} ATK vs ${defenseStat} DEF + ${diceRoll} dice)`;
            
            // Check for victory
            if (defender.hp <= 0) {
                const p1Bar = createHPBar(gs.player1.hp, 50);
                const p2Bar = createHPBar(gs.player2.hp, 50);
                
                reply(`${attackMessage}

${p1Bar}    ${p2Bar}
[icon]${gs.player1.displayName}[/icon] HP: ${gs.player1.hp}/50 vs [icon]${gs.player2.displayName}[/icon] HP: ${gs.player2.hp}/50

[b]🏆 ${attacker.displayName} WINS! 🏆[/b]`);
                
                // Reset game state
                context.gameState = null;
                return;
            }
            
            // Switch turns
            gs.currentTurn = gs.currentTurn === 1 ? 2 : 1;
            
            reply(formatBattleStatus(gs, attackMessage));
        } catch (error) {
            console.error(`[${name}] Attack error:`, error);
            reply('An error occurred during the attack. Please try again.');
        }
    },

    /**
     * !status - Show current battle status
     */
    status: async ({ context, reply }) => {
        if (!context.gameState) {
            if (context.readyPlayer) {
                reply(`[icon]${context.readyPlayer.displayName}[/icon] is waiting for an opponent. Use !ready to join!`);
            } else {
                reply('No battle in progress. Use !ready to start one!');
            }
            return;
        }
        
        reply(formatBattleStatus(context.gameState));
    },

    /**
     * !giveup - Forfeit the current battle
     */
    giveup: async ({ character, context, reply }) => {
        if (!context.gameState) {
            reply('No battle is currently in progress!');
            return;
        }
        
        const gs = context.gameState;
        const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
        const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();
        
        if (!isPlayer1 && !isPlayer2) {
            reply(`${character}, you're not in this battle!`);
            return;
        }
        
        const loser = isPlayer1 ? gs.player1 : gs.player2;
        const winner = isPlayer1 ? gs.player2 : gs.player1;
        
        reply(`[b]${loser.displayName}[/b] has given up!
[b]🏆 ${winner.displayName} WINS BY FORFEIT! 🏆[/b]`);
        
        context.gameState = null;
    },

    /**
     * !endbattle - End the current battle (admin/reset)
     */
    endbattle: async ({ context, reply }) => {
        if (!context.gameState && !context.readyPlayer) {
            reply('No battle or ready player to reset.');
            return;
        }
        
        context.gameState = null;
        context.readyPlayer = null;
        reply('Battle has been ended and the stage has been reset.');
    },

    /**
     * !lswhelp - Show LSW help
     */
    lswhelp: async ({ reply }) => {
        reply(`[b]LSW Commands:[/b]
[b]!register[/b] - Register to play LSW
[b]!train <attack/defense> on <part>[/b] - Spend training points to increase a stat
[b]!indulge <attack/defense> on <part>[/b] - Decrease a stat to regain training points
[b]!stats[/b] - View your current stats
[b]!ready[/b] - Ready up for battle
[b]!attack <your part> to <their part>[/b] - Attack during battle
[b]!status[/b] - View current battle status
[b]!giveup[/b] - Forfeit the current battle
[b]!endbattle[/b] - Reset the battle state

[b]Parts:[/b] lips, fingers, chest, body, feet
[b]Max stat:[/b] 5 per stat`);
    }
};
