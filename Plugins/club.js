/**
 * Club Dice Combat Plugin
 * A structured dice-based combat system for role-playing fights
 * Based on the Club Rules document
 */

import { MongoClient } from 'mongodb';

// Plugin metadata
export const name = 'club';
export const description = 'Dice Combat Game - A d20-based combat system with phases';
export const version = '1.0.0';

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = 'flist_bot';
const COLLECTION_NAME = 'club_players';

let mongoClient = null;
let db = null;

// Pending private games keyed by expected room name (for private room creation flow)
const pendingPrivateGames = new Map();

// Phase definitions
const PHASES = {
    1: { name: 'Struggle/Grapple/Pin', winAdvance: 2, loseRegress: 1, loseSwapAttacker: true },
    2: { name: 'Strip/Fully Pin', winAdvance: 3, loseRegress: 1 },
    3: { name: 'Penetration', winAdvance: 4, loseRegress: 2, winDefenderDebuff: -1 },
    4: { name: 'Fuck Check 1', winAdvance: 5, loseRegress: 3, winDefenderDebuff: -1 },
    5: { name: 'Fuck Check 2', winAdvance: 6, loseRegress: 4, winDefenderDebuff: -2 },
    6: { name: 'Climax', winAdvance: null, loseRegress: 5 }
};

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
 * Roll a d20
 */
function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
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
        height: 0, // Height in feet for size difference calculations
        bodyType: 0, // Body type modifier: -2 to +2
        wins: 0,
        losses: 0,
        winStreak: 0,
        lossStreak: 0,
        createdAt: new Date()
    };
    await collection.insertOne(player);
    return player;
}

/**
 * Update player data
 */
async function updatePlayer(username, updates) {
    const collection = await getPlayersCollection();
    await collection.updateOne(
        { username: username.toLowerCase() },
        { $set: updates }
    );
}

/**
 * Record match result - updates wins/losses for both players
 */
async function recordMatchResult(winnerName, loserName) {
    const winnerData = await getPlayer(winnerName);
    const loserData = await getPlayer(loserName);
    
    if (winnerData) {
        await updatePlayer(winnerName, {
            wins: winnerData.wins + 1,
            winStreak: winnerData.winStreak + 1,
            lossStreak: 0
        });
    }
    
    if (loserData) {
        await updatePlayer(loserName, {
            losses: loserData.losses + 1,
            lossStreak: loserData.lossStreak + 1,
            winStreak: 0
        });
    }
}

/**
 * Body type definitions
 */
const BODY_TYPES = {
    '-2': 'Fat',
    '-2': 'Chubby',
    '-1': 'Thicc',
    '-1': 'Curvy',
    '0': 'Average',
    '1': 'Toned',
    '2': 'Buff'
};

/**
 * Get body type name from modifier value
 */
function getBodyTypeName(value) {
    return BODY_TYPES[String(value)] || 'Average';
}

/**
 * Calculate size modifier based on height difference
 */
function getSizeModifier(attackerHeight, defenderHeight) {
    if (attackerHeight === 0 || defenderHeight === 0) return 0;
    const diff = Math.abs(attackerHeight - defenderHeight);
    if (diff === 0) return 0;
    
    const isLarger = attackerHeight > defenderHeight;
    if (diff > 2) {
        return isLarger ? 2 : -2;
    } else if (diff >= 1) {
        return isLarger ? 1 : -1;
    }
    return 0;
}

/**
 * Calculate streak modifier
 */
function getStreakModifier(player) {
    if (player.winStreak >= 4) return 3;
    if (player.winStreak >= 3) return 2;
    if (player.winStreak >= 2) return 1;
    if (player.lossStreak >= 4) return -3;
    if (player.lossStreak >= 3) return -2;
    if (player.lossStreak >= 2) return -1;
    return 0;
}

/**
 * Calculate Rank modifier based on wins/losess
 */
function getRankModifier(player) {
    const positiveRank = player.wins * 10;
    const negativeRank = player.losses * 8;
    const totalRank = Math.max(Math.min(positiveRank - negativeRank, 100), -100);
    // Map totalRank to a modifier: -100 should be -3, +100 should be +3
    let rankModifier = 0;
    let rankTitle = "";
    if (totalRank >= 90) { rankModifier = 3; rankTitle = "Champion"; }
    else if (totalRank >= 60) { rankModifier = 2; rankTitle = "Veteran"; }
    else if (totalRank >= 30) { rankModifier = 1; rankTitle = "Experienced"; }
    else if (totalRank <= -30) { rankModifier = -1; rankTitle = "Subby"; }
    else if (totalRank <= -60) { rankModifier = -2; rankTitle = "Loser"; }
    else if (totalRank <= -90) { rankModifier = -3; rankTitle = "Cumslut"; }
    return { rankModifier, totalRank, rankTitle };
}

/**
 * Format modifier string for display
 */
function formatModifier(mod) {
    if (mod === 0) return '';
    return mod > 0 ? `+${mod}` : `${mod}`;
}

/**
 * Create phase progress bar
 */
function createPhaseBar(currentPhase) {
    let bar = '';
    for (let i = 1; i <= 6; i++) {
        if (i < currentPhase) {
            bar += '[color=green]●[/color] ';
        } else if (i === currentPhase) {
            bar += '[color=yellow]◆[/color] ';
        } else {
            bar += '[color=gray]○[/color] ';
        }
    }
    return bar;
}

/**
 * Format game state for display
 */
function formatGameStatus(gs) {
    const phaseInfo = PHASES[gs.phase];
    const attacker = gs.currentAttacker === 1 ? gs.player1 : gs.player2;
    const defender = gs.currentAttacker === 1 ? gs.player2 : gs.player1;
    
    let status = `[b]═══ DICE COMBAT ═══[/b]
${createPhaseBar(gs.phase)}
[b]Phase ${gs.phase}:[/b] ${phaseInfo.name}

[b]Attacker:[/b] [icon]${attacker.displayName}[/icon] ${formatModifierSummary(attacker, gs, true)} | [b]Defender:[/b] [icon]${defender.displayName}[/icon] ${formatModifierSummary(defender, gs, false)}

[i]${attacker.displayName} should RP their action, then use [b]!roll[/b][/i]`;
    
    return status;
}

/**
 * Format modifier summary for a player
 */
function formatModifierSummary(player, gs, isAttacker) {
    const mods = [];
    
    // Size modifier (attack only)
    if (isAttacker && player.sizeModifier !== 0) {
        mods.push(`Size: ${formatModifier(player.sizeModifier)}`);
    }
    
    // Body type modifier
    if (player.bodyTypeModifier !== 0) {
        mods.push(`Body: ${formatModifier(player.bodyTypeModifier)}`);
    }
    
    // Streak modifier
    if (player.streakModifier !== 0) {
        mods.push(`Streak: ${formatModifier(player.streakModifier)}`);
    }

    // Rank modifier
    if (player.rankModifier !== 0) {
        mods.push(`Rank: ${formatModifier(player.rankModifier)}`);
    }
    
    // Battle debuffs
    if (player.battleDebuff !== 0) {
        mods.push(`Debuff: ${formatModifier(player.battleDebuff)}`);
    }
    
    if (mods.length === 0) return '';
    return `(${mods.join(', ')})`;
}

/**
 * Calculate total modifier for a roll
 */
function calculateTotalModifier(player, gs, isAttacker, isDefenseRoll = false) {
    let total = 0;
    
    // Size modifier only applies to attacks, not defense
    if (isAttacker && !isDefenseRoll) {
        total += player.sizeModifier || 0;
    }
    
    // Body type always applies
    total += player.bodyTypeModifier || 0;
    
    // Streak always applies
    total += player.streakModifier || 0;

    // Rank always applies
    total += player.rankModifier || 0;
    
    // Battle debuffs always apply
    total += player.battleDebuff || 0;
    
    return total;
}

/**
 * Process roll outcome and determine winner
 */
function determineRollWinner(attackerRoll, defenderRoll, attackerMod, defenderMod) {
    const attackerTotal = attackerRoll + attackerMod;
    const defenderTotal = defenderRoll + defenderMod;
    
    // Both roll 1 = wash
    if (attackerRoll === 1 && defenderRoll === 1) {
        return { result: 'wash', attackerTotal, defenderTotal };
    }
    
    // Attacker rolls 1 = auto-loss
    if (attackerRoll === 1) {
        return { result: 'defender', attackerTotal, defenderTotal, criticalFailure: true };
    }
    
    // Defender rolls 1 = auto-loss for defender
    if (defenderRoll === 1) {
        return { result: 'attacker', attackerTotal, defenderTotal, criticalFailure: true };
    }
    
    // Both roll natural 20 = defender wins
    if (attackerRoll === 20 && defenderRoll === 20) {
        return { result: 'defender', attackerTotal, defenderTotal, doubleCrit: true };
    }
    
    // Check for crits (total 20+)
    // A player cannot crit if their modifier is negative (even a nat 20 + negative mod < 20)
    const attackerCanCrit = attackerMod >= 0;
    const defenderCanCrit = defenderMod >= 0;
    const attackerCrit = attackerCanCrit && attackerTotal >= 20;
    const defenderCrit = defenderCanCrit && defenderTotal >= 20;
    
    if (attackerCrit && defenderCrit) {
        return { result: 'draw', attackerTotal, defenderTotal, bothCrit: true };
    }
    
    if (attackerCrit) {
        return { result: 'attacker', attackerTotal, defenderTotal, crit: true };
    }
    
    if (defenderCrit) {
        return { result: 'defender', attackerTotal, defenderTotal, crit: true };
    }
    
    // Standard comparison - ties go to defender
    if (attackerTotal > defenderTotal) {
        return { result: 'attacker', attackerTotal, defenderTotal };
    }
    
    return { result: 'defender', attackerTotal, defenderTotal };
}

/**
 * Apply phase outcome
 * @param {object} gs - game state
 * @param {boolean} attackerWon - whether the attacker won the roll
 * @param {boolean} criticalFailure - if true, the loser rolled a nat 1 (extra phase skip)
 */
function applyPhaseOutcome(gs, attackerWon, criticalFailure = false) {
    const phaseInfo = PHASES[gs.phase];
    const attacker = gs.currentAttacker === 1 ? gs.player1 : gs.player2;
    const defender = gs.currentAttacker === 1 ? gs.player2 : gs.player1;

    let message = '';

    if (attackerWon) {
        // Apply debuff if this phase gives one on win
        if (phaseInfo.winDefenderDebuff) {
            defender.battleDebuff = (defender.battleDebuff || 0) + phaseInfo.winDefenderDebuff;
            message += `\n[color=red]${defender.displayName} gains ${phaseInfo.winDefenderDebuff} to all defense rolls![/color]`;
        }

        // Strip defender if Phase 2 is won AND defender is still clothed
        if (gs.phase === 2 && defender.clothed) {
            defender.clothed = false;
            message += `\n[color=yellow]${defender.displayName} has been stripped![/color]`;
        } else if (gs.phase === 2 && !defender.clothed) {
            message += `\n[color=yellow]${defender.displayName} is already naked - pinned down![/color]`;
        }

        // Advance phase
        if (phaseInfo.winAdvance === null) {
            // Victory!
            gs.finished = true;
            gs.winner = attacker;
            gs.loser = defender;
            message += `\n\n[b]🏆 ${attacker.displayName} WINS THE FIGHT! 🏆[/b]`;
        } else {
            let nextPhase = phaseInfo.winAdvance;

            // Phase 2 is NOT skipped - it converts to a Pin phase when defender is naked

            gs.phase = nextPhase;
            message += `\n[color=green]Advancing to Phase ${gs.phase}: ${PHASES[gs.phase].name}[/color]`;

            // Critical failure (nat 1): advance one MORE phase
            if (criticalFailure && !gs.finished) {
                message += `\n[color=red]Nat 1 penalty! Skipping an extra phase![/color]`;
                const extraPhaseInfo = PHASES[gs.phase];
                if (extraPhaseInfo.winAdvance === null) {
                    // Landing on climax phase via extra skip = victory
                    gs.finished = true;
                    gs.winner = attacker;
                    gs.loser = defender;
                    message += `\n\n[b]🏆 ${attacker.displayName} WINS THE FIGHT! 🏆[/b]`;
                } else {
                    // If skipping through Phase 2, strip defender if clothed
                    if (gs.phase === 2 && defender.clothed) {
                        defender.clothed = false;
                        message += `\n[color=yellow]${defender.displayName} has been stripped![/color]`;
                    }
                    // Apply debuff if the skipped phase has one
                    if (extraPhaseInfo.winDefenderDebuff) {
                        defender.battleDebuff = (defender.battleDebuff || 0) + extraPhaseInfo.winDefenderDebuff;
                        message += `\n[color=red]${defender.displayName} gains ${extraPhaseInfo.winDefenderDebuff} to all defense rolls![/color]`;
                    }
                    gs.phase = extraPhaseInfo.winAdvance;
                    message += `\n[color=green]Now at Phase ${gs.phase}: ${PHASES[gs.phase].name}[/color]`;
                }
            }
        }
    } else {
        // Defender won the roll

        // Apply debuff if this phase gives one on loss
        if (phaseInfo.loseDefenderDebuff) {
            defender.battleDebuff = (defender.battleDebuff || 0) + phaseInfo.loseDefenderDebuff;
            message += `\n[color=red]${defender.displayName} gains ${phaseInfo.loseDefenderDebuff} to future rolls for failing in Phase 3![/color]`;
        }

        // Regress phase - Phase 2 is NOT skipped, it converts to Pin
        let regressPhase = phaseInfo.loseRegress;

        gs.phase = regressPhase;
        message += `\n[color=orange]Regressing to Phase ${gs.phase}: ${PHASES[gs.phase].name}[/color]`;

        // Critical failure (nat 1): regress one MORE phase
        if (criticalFailure && !gs.finished) {
            message += `\n[color=red]Nat 1 penalty! Regressing an extra phase![/color]`;
            const extraPhaseInfo = PHASES[gs.phase];
            let extraRegress = extraPhaseInfo.loseRegress;
            // Don't go below phase 1
            if (extraRegress < 1) extraRegress = 1;
            gs.phase = extraRegress;
            message += `\n[color=orange]Now at Phase ${gs.phase}: ${PHASES[gs.phase].name}[/color]`;
        }

        // Swap attacker if the original phase requires it (swap only once regardless of crit)
        if (phaseInfo.loseSwapAttacker) {
            gs.currentAttacker = gs.currentAttacker === 1 ? 2 : 1;
            const newAttacker = gs.currentAttacker === 1 ? gs.player1 : gs.player2;
            message += `\n[b]${newAttacker.displayName} is now the attacker![/b]`;
        }
    }

    return message;
}

/**
 * Called when the plugin is attached to a room
 */
export function onAttach({ client, channel, context }) {
    console.log(`[${name}] Attached to ${channel}`);

    // Initialize game state for this room
    context.gameState = null;
    context.challengeState = null;
    context.pendingRolls = {}; // Track who has rolled
    context.isDynamicRoom = false;

    // Check if there's a pending private game for this room
    // The channel ID from F-List may differ from the room name, so also check by title
    for (const [roomKey, pendingData] of pendingPrivateGames.entries()) {
        if (channel.toLowerCase() === roomKey || channel.toLowerCase().includes(roomKey)) {
            console.log(`[${name}] Found pending private game for room ${channel}`);
            context.gameState = pendingData.gameState;
            context.pendingRolls = {};
            context.isDynamicRoom = true;
            pendingPrivateGames.delete(roomKey);

            // Announce the fight start in the private room
            const p1 = pendingData.player1Name;
            const p2 = pendingData.player2Name;
            client.sendChannelMessage(channel, `[b]⚔️ PRIVATE FIGHT ROOM ⚔️[/b]
[icon]${p1}[/icon] vs [icon]${p2}[/icon]

[b]INITIATIVE ROLL[/b]
Both fighters, use [b]!roll[/b] to determine who attacks first!`);
            break;
        }
    }

    // Also listen for JCH events to match pending games by title
    const onJoinedChannel = ({ channel: joinedChannel, title }) => {
        if (!title) return;
        const titleKey = title.toLowerCase();
        for (const [roomKey, pendingData] of pendingPrivateGames.entries()) {
            if (titleKey === roomKey || titleKey.includes(roomKey)) {
                console.log(`[${name}] Matched pending game by title for ${joinedChannel}`);
                context.gameState = pendingData.gameState;
                context.pendingRolls = {};
                context.isDynamicRoom = true;
                pendingPrivateGames.delete(roomKey);

                const p1 = pendingData.player1Name;
                const p2 = pendingData.player2Name;
                client.sendChannelMessage(joinedChannel, `[b]⚔️ PRIVATE FIGHT ROOM ⚔️[/b]
[icon]${p1}[/icon] vs [icon]${p2}[/icon]

[b]INITIATIVE ROLL[/b]
Both fighters, use [b]!roll[/b] to determine who attacks first!`);

                client.removeListener('joinedChannel', onJoinedChannel);
                break;
            }
        }
    };

    // Only set up the listener if there are pending games
    if (pendingPrivateGames.size > 0) {
        client.on('joinedChannel', onJoinedChannel);
        // Clean up listener after 30 seconds
        setTimeout(() => {
            client.removeListener('joinedChannel', onJoinedChannel);
        }, 30000);
    }

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
 * Leave a dynamic (private) room after a fight ends
 */
function leaveDynamicRoomIfNeeded(client, channel, context) {
    if (context.isDynamicRoom) {
        // Leave the private room after a short delay so final messages are seen
        setTimeout(() => {
            client.leaveChannel(channel);
            console.log(`[${name}] Left dynamic room ${channel} after fight ended`);
        }, 5000);
    }
}

/**
 * Command handlers
 */
export const commands = {
    /**
     * !clubregister - Register a new player
     */
    clubregister: async ({ character, reply }) => {
        try {
            const existingPlayer = await getPlayer(character);
            
            if (existingPlayer) {
                reply(`${character}, you are already registered! Use !clubstats to see your stats.`);
                return;
            }
            
            const player = await createPlayer(character);
            reply(`Welcome to Dice Combat, ${character}! You have been registered.
Use [b]!setheight <feet>[/b] to set your height for size modifiers.
Use [b]!setbodytype <type>[/b] to set your body type modifier.
Use [b]!clubstats[/b] to view your record.
Use [b]!challenge <player>[/b] to challenge someone to a fight!`);
        } catch (error) {
            console.error(`[${name}] Register error:`, error);
            reply('An error occurred during registration. Please try again later.');
        }
    },

    /**
     * !setheight <feet> - Set player height
     */
    setheight: async ({ character, args, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !clubregister first!`);
                return;
            }
            
            let height = parseFloat(args[0]);
            //round to nearest 0.1
            height = Math.round(height * 10) / 10;
            
            if (isNaN(height) || height <= 0 || height > 20) {
                reply('Usage: !setheight <feet> (e.g., !setheight 5.5 for 5\'6") The maximum height is 20 feet.');
                return;
            }
            
            await updatePlayer(character, { height });
            
            const feet = Math.floor(height);
            const inches = Math.round((height - feet) * 12);
            reply(`${character}'s height set to ${feet}'${inches}" (${height} feet)`);
        } catch (error) {
            console.error(`[${name}] SetHeight error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !setbodytype <type> - Set player body type
     */
    setbodytype: async ({ character, args, reply }) => {
        try {
            const player = await getPlayer(character);
            
            if (!player) {
                reply(`${character}, you need to !clubregister first!`);
                return;
            }
            
            if (args.length === 0) {
                reply(`Usage: !setbodytype <type>
Valid types: fat, chubby, thicc, curvy, average, toned, buff`);
                return;
            }
            
            const input = args.join(' ').toLowerCase();
            let bodyType = 0;
            
            if (input === 'fat' || input === 'chubby' || input === 'fat/chubby') {
                bodyType = -2;
            } else if (input === 'thicc' || input === 'curvy' || input === 'thicc/curvy' || input === 'thick') {
                bodyType = -1;
            } else if (input === 'average') {
                bodyType = 0;
            } else if (input === 'toned' || input === 'fit') {
                bodyType = 1;
            } else if (input === 'buff' || input === 'muscular') {
                bodyType = 2;
            } else {
                reply(`Invalid body type. Valid types: fat, chubby, thicc, curvy, average, toned, buff`);
                return;
            }
            
            await updatePlayer(character, { bodyType });
            reply(`${character}'s body type set to ${getBodyTypeName(bodyType)} (${formatModifier(bodyType)})`);
        } catch (error) {
            console.error(`[${name}] SetBodyType error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !clubstats [player] - Show player stats
     */
    clubstats: async ({ character, args, reply }) => {
        try {
            const targetName = args.length > 0 ? args.join(' ') : character;
            const player = await getPlayer(targetName);
            
            if (!player) {
                reply(`${targetName} is not registered. Use !clubregister to register.`);
                return;
            }
            
            const feet = Math.floor(player.height);
            const inches = Math.round((player.height - feet) * 12);
            const heightStr = player.height > 0 ? `${feet}'${inches}"` : 'Not set';
            
            const bodyTypeValue = player.bodyType || 0;
            const bodyTypeStr = `${getBodyTypeName(bodyTypeValue)} (${formatModifier(bodyTypeValue)})`;
            
            const streakMod = getStreakModifier(player);
            let streakStr = 'None';
            if (player.winStreak >= 2) {
                streakStr = `${player.winStreak} wins (${formatModifier(streakMod)})`;
                if (player.winStreak >= 4) streakStr += ' [CHAMPION]';
            } else if (player.lossStreak >= 2) {
                streakStr = `${player.lossStreak} losses (${formatModifier(streakMod)})`;
            }

            const { rankModifier, totalRank, rankTitle } = getRankModifier(player);
            
            reply(`[b]═══ ${player.displayName}'s Combat Record ═══[/b]
[b]Height:[/b] ${heightStr}
[b]Body Type:[/b] ${bodyTypeStr}
[b]Wins:[/b] ${player.wins} | [b]Losses:[/b] ${player.losses}
[b]Current Streak:[/b] ${streakStr}
[b]Rank Score:[/b] ${totalRank} ${rankTitle} (${formatModifier(rankModifier)})`);
        } catch (error) {
            console.error(`[${name}] Stats error:`, error);
            reply('An error occurred while fetching stats. Please try again later.');
        }
    },

    /**
     * !challenge <player> - Challenge another player
     */
    challenge: async ({ character, args, context, reply }) => {
        try {
            if (context.gameState) {
                reply('A fight is already in progress! Use !endfight to reset.');
                return;
            }
            
            if (args.length === 0) {
                reply('Usage: !challenge <player>');
                return;
            }
            
            const challenger = await getPlayer(character);
            if (!challenger) {
                reply(`${character}, you need to !clubregister first!`);
                return;
            }
            
            const targetName = args.join(' ');
            const target = await getPlayer(targetName);
            
            if (!target) {
                reply(`${targetName} is not registered!`);
                return;
            }
            
            if (target.username === challenger.username) {
                reply("You can't challenge yourself!");
                return;
            }
            
            context.challengeState = {
                challenger: challenger,
                target: target
            };
            
            reply(`[b]⚔️ CHALLENGE! ⚔️[/b]
[icon]${challenger.displayName}[/icon] has challenged [icon]${target.displayName}[/icon] to a dice combat fight!
${target.displayName}, use [b]!accept[/b] to accept or [b]!decline[/b] to decline.`);
        } catch (error) {
            console.error(`[${name}] Challenge error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !accept - Accept a challenge
     */
    accept: async ({ character, context, client, reply }) => {
        try {
            if (!context.challengeState) {
                reply('There is no pending challenge.');
                return;
            }

            if (context.challengeState.target.displayName.toLowerCase() !== character.toLowerCase()) {
                reply(`${character}, you were not challenged!`);
                return;
            }

            // Start initiative phase
            const p1 = context.challengeState.challenger;
            const p2 = context.challengeState.target;

            const gameState = {
                player1: {
                    ...p1,
                    sizeModifier: getSizeModifier(p1.height, p2.height),
                    bodyTypeModifier: p1.bodyType || 0,
                    streakModifier: getStreakModifier(p1),
                    rankModifier: getRankModifier(p1).rankModifier,
                    battleDebuff: 0,
                    clothed: true
                },
                player2: {
                    ...p2,
                    sizeModifier: getSizeModifier(p2.height, p1.height),
                    bodyTypeModifier: p2.bodyType || 0,
                    streakModifier: getStreakModifier(p2),
                    rankModifier: getRankModifier(p2).rankModifier,
                    battleDebuff: 0,
                    clothed: true
                },
                phase: 0, // Initiative phase
                currentAttacker: null,
                initiativeState: 'rolling'
            };

            context.challengeState = null;

            // Create a private room for the fight
            const roomName = `Fight: ${p1.displayName} vs ${p2.displayName}`;

            // Store pending game data keyed by room name for pickup in onAttach
            pendingPrivateGames.set(roomName.toLowerCase(), {
                gameState,
                player1Name: p1.displayName,
                player2Name: p2.displayName
            });

            // Create the private room (bot auto-joins on creation)
            client.send('CCR', { channel: roomName });

            // Invite both players to the private room
            client.send('CIU', { channel: roomName, character: p1.displayName });
            client.send('CIU', { channel: roomName, character: p2.displayName });

            reply(`[b]⚔️ FIGHT ACCEPTED! ⚔️[/b]
[icon]${p1.displayName}[/icon] vs [icon]${p2.displayName}[/icon]

A private room "[b]${roomName}[/b]" is being created. Both fighters will be invited.
Head to the private room to begin the fight!`);
        } catch (error) {
            console.error(`[${name}] Accept error:`, error);
            reply('An error occurred. Please try again later.');
        }
    },

    /**
     * !decline - Decline a challenge
     */
    decline: async ({ character, context, reply }) => {
        if (!context.challengeState) {
            reply('There is no pending challenge.');
            return;
        }
        
        if (context.challengeState.target.displayName.toLowerCase() !== character.toLowerCase()) {
            reply(`${character}, you were not challenged!`);
            return;
        }
        
        const challenger = context.challengeState.challenger.displayName;
        context.challengeState = null;
        
        reply(`${character} has declined ${challenger}'s challenge.`);
    },

    /**
     * !roll - Roll d20 during combat
     */
    roll: async ({ character, context, client, channel, reply }) => {
        try {
            if (!context.gameState) {
                reply('No fight is in progress! Use !challenge to start one.');
                return;
            }
            
            const gs = context.gameState;
            const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
            const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();
            
            if (!isPlayer1 && !isPlayer2) {
                reply(`${character}, you're not in this fight!`);
                return;
            }
            
            const playerNum = isPlayer1 ? 1 : 2;
            const player = isPlayer1 ? gs.player1 : gs.player2;
            
            // Initiative phase
            if (gs.phase === 0) {
                if (context.pendingRolls[playerNum]) {
                    reply(`${character}, you've already rolled for initiative!`);
                    return;
                }
                
                const roll = rollD20();
                context.pendingRolls[playerNum] = { roll, player };
                
                let initiativeMsg = `[icon]${character}[/icon] rolls for initiative: [b]${roll}[/b]`;
                
                // Check if both have rolled
                if (context.pendingRolls[1] && context.pendingRolls[2]) {
                    const r1 = context.pendingRolls[1].roll;
                    const r2 = context.pendingRolls[2].roll;
                    
                    if (r1 === r2) {
                        // Tie - reroll
                        context.pendingRolls = {};
                        initiativeMsg += `\n[b]TIE![/b] Both rolled ${r1}. Roll again!`;
                        reply(initiativeMsg);
                        return;
                    }
                    
                    gs.currentAttacker = r1 > r2 ? 1 : 2;
                    gs.phase = 1;
                    context.pendingRolls = {};
                    
                    const winner = gs.currentAttacker === 1 ? gs.player1 : gs.player2;
                    
                    initiativeMsg += `\n[b]${winner.displayName} wins initiative and attacks first![/b] (${r1} vs ${r2})

${formatGameStatus(gs)}`;
                }
                
                reply(initiativeMsg);
                return;
            }
            
            // Combat phase - check if it's attacker's turn
            const isAttacker = gs.currentAttacker === playerNum;
            
            // Handle the roll based on current state
            if (gs.waitingForDefender) {
                // Defender's turn
                if (isAttacker) {
                    reply(`${character}, wait for the defender to roll!`);
                    return;
                }
                
                // If there's a stun attempt, defender must use !defendstun
                if (gs.stunAttempt) {
                    reply(`${character}, you must use [b]!defendstun[/b] to defend against the stun attempt!`);
                    return;
                }
                
                const defenderRoll = rollD20();
                const defender = player;
                const attacker = gs.currentAttacker === 1 ? gs.player1 : gs.player2;
                
                const attackerMod = calculateTotalModifier(attacker, gs, true, false);
                const defenderMod = calculateTotalModifier(defender, gs, false, true);
                
                const outcome = determineRollWinner(
                    gs.attackerRoll,
                    defenderRoll,
                    attackerMod,
                    defenderMod
                );
                
                let rollMsg = `[icon]${defender.displayName}[/icon] defends with: [b]${defenderRoll}[/b]${formatModifier(defenderMod)} = [b]${outcome.defenderTotal}[/b] `;
                rollMsg += `[icon]${attacker.displayName}[/icon] had: [b]${gs.attackerRoll}[/b]${formatModifier(attackerMod)} = [b]${outcome.attackerTotal}[/b] `;
                
                // Determine outcome
                if (outcome.result === 'wash') {
                    rollMsg += `[b]WASH![/b] Both rolled 1! No effect - roll again.`;
                    gs.waitingForDefender = false;
                    gs.attackerRoll = null;
                } else if (outcome.result === 'draw') {
                    rollMsg += `[b]DRAW![/b] Both achieved crits! Roll again.`;
                    gs.waitingForDefender = false;
                    gs.attackerRoll = null;
                } else {
                    const attackerWon = outcome.result === 'attacker';
                    
                    if (outcome.criticalFailure) {
                        rollMsg += `[b]CRITICAL FAILURE![/b] Rolling a 1 is an automatic loss!\n`;
                    } else if (outcome.crit) {
                        rollMsg += `[b]CRIT![/b] A total of 20+ is a critical hit!\n`;
                    } else if (outcome.doubleCrit) {
                        rollMsg += `[b]DOUBLE NATURAL 20![/b] Defender wins on matching nat 20s!\n`;
                    }
                    
                    rollMsg += attackerWon 
                        ? `[color=green][b]${attacker.displayName} wins the roll![/b][/color]`
                        : `[color=orange][b]${defender.displayName} wins the roll![/b][/color]`;
                    
                    // Apply phase outcome (pass criticalFailure for nat 1 extra skip)
                    rollMsg += applyPhaseOutcome(gs, attackerWon, outcome.criticalFailure || false);

                    gs.waitingForDefender = false;
                    gs.attackerRoll = null;
                    
                    // Check for victory
                    if (gs.finished) {
                        // Update player records
                        await recordMatchResult(gs.winner.displayName, gs.loser.displayName);

                        context.gameState = null;
                        reply(rollMsg);
                        leaveDynamicRoomIfNeeded(client, channel, context);
                        return;
                    }
                }
                
                if (!gs.finished) {
                    rollMsg += `\n\n${formatGameStatus(gs)}`;
                }
                
                reply(rollMsg);
                return;
            }
            
            // Attacker's turn
            if (!isAttacker) {
                reply(`${character}, it's not your turn to roll!`);
                return;
            }
            
            const attackerRoll = rollD20();
            const attackerMod = calculateTotalModifier(player, gs, true, false);
            
            gs.attackerRoll = attackerRoll;
            gs.waitingForDefender = true;
            
            const defender = gs.currentAttacker === 1 ? gs.player2 : gs.player1;
            
            reply(`[icon]${character}[/icon] attacks with: [b]${attackerRoll}[/b]${formatModifier(attackerMod)} = [b]${attackerRoll + attackerMod}[/b]

[i]${defender.displayName}, use [b]!roll[/b] to defend and then RP the outcome![/i]`);
            
        } catch (error) {
            console.error(`[${name}] Roll error:`, error);
            reply('An error occurred during the roll. Please try again.');
        }
    },

    /**
     * !stun - Attempt a stun (high-risk, high-reward)
     */
    stun: async ({ character, context, reply }) => {
        try {
            if (!context.gameState) {
                reply('No fight is in progress!');
                return;
            }
            
            const gs = context.gameState;
            
            if (gs.phase === 0) {
                reply("Can't use stun during initiative!");
                return;
            }
            
            const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
            const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();
            
            if (!isPlayer1 && !isPlayer2) {
                reply(`${character}, you're not in this fight!`);
                return;
            }
            
            const playerNum = isPlayer1 ? 1 : 2;
            const isAttacker = gs.currentAttacker === playerNum;
            
            if (!isAttacker) {
                reply(`${character}, only the attacker can attempt a stun!`);
                return;
            }
            
            if (gs.waitingForDefender) {
                reply('A roll is already in progress!');
                return;
            }
            
            gs.stunAttempt = true;
            gs.waitingForDefender = true;
            
            const attacker = isPlayer1 ? gs.player1 : gs.player2;
            const defender = isPlayer1 ? gs.player2 : gs.player1;
            
            const attackerRoll = rollD20();
            const attackerMod = calculateTotalModifier(attacker, gs, true, false);
            
            gs.attackerRoll = attackerRoll;
            
            reply(`[b]⚡ STUN ATTEMPT! ⚡[/b]
[icon]${attacker.displayName}[/icon] attempts a high-risk stun!
Attack roll: [b]${attackerRoll}[/b]${formatModifier(attackerMod)} = [b]${attackerRoll + attackerMod}[/b]

[color=yellow]⚠️ High risk! Failure will leave ${attacker.displayName} vulnerable![/color]

${defender.displayName}, use [b]!defendstun[/b] to defend!`);
            
        } catch (error) {
            console.error(`[${name}] Stun error:`, error);
            reply('An error occurred. Please try again.');
        }
    },

    /**
     * !defendstun - Defend against a stun (for tie resolution)
     */
    defendstun: async ({ character, context, client, channel, reply }) => {
        try {
            if (!context.gameState || !context.gameState.stunAttempt || !context.gameState.waitingForDefender) {
                reply('No stun to defend against!');
                return;
            }
            
            const gs = context.gameState;
            const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
            const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();
            
            if (!isPlayer1 && !isPlayer2) {
                reply(`${character}, you're not in this fight!`);
                return;
            }
            
            const playerNum = isPlayer1 ? 1 : 2;
            const isAttacker = gs.currentAttacker === playerNum;
            
            if (isAttacker) {
                reply(`${character}, you're the attacker! Wait for the defender.`);
                return;
            }
            
            const defender = isPlayer1 ? gs.player1 : gs.player2;
            const attacker = isPlayer1 ? gs.player2 : gs.player1;
            
            const defenderRoll = rollD20();
            const attackerMod = calculateTotalModifier(attacker, gs, true, false);
            const defenderMod = calculateTotalModifier(defender, gs, false, true);
            
            const attackerTotal = gs.attackerRoll + attackerMod;
            const defenderTotal = defenderRoll + defenderMod;
            
            let rollMsg = `[icon]${defender.displayName}[/icon] defends: [b]${defenderRoll}[/b]${formatModifier(defenderMod)} = [b]${defenderTotal}[/b]\n`;
            
            // Stun resolution
            // Rolling a 1 on stun = auto-fail
            if (gs.attackerRoll === 1) {
                rollMsg += `\n[b]CRITICAL FAILURE![/b] ${attacker.displayName} rolled a 1 and auto-fails the stun!\n`;
                rollMsg += applyStunFailure(gs, attacker, defender);
            } else if (defenderRoll === 1) {
                rollMsg += `\n[b]CRITICAL FAILURE![/b] ${defender.displayName} rolled a 1!\n`;
                rollMsg += await applyStunSuccess(gs, attacker, defender);
            } else if (attackerTotal === defenderTotal) {
                // Tie on stun = reroll
                rollMsg += `\n[b]TIE![/b] Stuns require a reroll on ties. Roll again!`;
                gs.attackerRoll = null;
                gs.waitingForDefender = false;
                gs.stunAttempt = false;
                reply(rollMsg);
                return;
            } else if (attackerTotal > defenderTotal) {
                rollMsg += `\n[color=green][b]STUN SUCCESSFUL![/b][/color]\n`;
                rollMsg += await applyStunSuccess(gs, attacker, defender);
            } else {
                rollMsg += `\n[color=red][b]STUN FAILED![/b][/color]\n`;
                rollMsg += applyStunFailure(gs, attacker, defender);
            }
            
            gs.stunAttempt = false;
            gs.waitingForDefender = false;
            gs.attackerRoll = null;
            
            if (gs.finished) {
                context.gameState = null;
                reply(rollMsg);
                leaveDynamicRoomIfNeeded(client, channel, context);
                return;
            }

            rollMsg += `\n\n${formatGameStatus(gs)}`;

            reply(rollMsg);

        } catch (error) {
            console.error(`[${name}] DefendStun error:`, error);
            reply('An error occurred. Please try again.');
        }
    },

    /**
     * !status - Show current fight status
     */
    status: async ({ context, reply }) => {
        if (!context.gameState) {
            if (context.challengeState) {
                reply(`[icon]${context.challengeState.challenger.displayName}[/icon] has challenged [icon]${context.challengeState.target.displayName}[/icon]. Waiting for response.`);
            } else {
                reply('No fight in progress. Use !challenge to start one!');
            }
            return;
        }
        
        const gs = context.gameState;
        
        if (gs.phase === 0) {
            let status = `[b]INITIATIVE PHASE[/b]\n`;
            if (context.pendingRolls[1]) {
                status += `${gs.player1.displayName} rolled: ${context.pendingRolls[1].roll}\n`;
            } else {
                status += `${gs.player1.displayName}: Waiting to roll\n`;
            }
            if (context.pendingRolls[2]) {
                status += `${gs.player2.displayName} rolled: ${context.pendingRolls[2].roll}`;
            } else {
                status += `${gs.player2.displayName}: Waiting to roll`;
            }
            reply(status);
            return;
        }
        
        reply(formatGameStatus(gs));
    },

    /**
     * !giveup - Forfeit the fight
     */
    forfeit: async ({ character, context, client, channel, reply }) => {
        if (!context.gameState) {
            reply('No fight is currently in progress!');
            return;
        }

        const gs = context.gameState;
        const isPlayer1 = gs.player1.displayName.toLowerCase() === character.toLowerCase();
        const isPlayer2 = gs.player2.displayName.toLowerCase() === character.toLowerCase();

        if (!isPlayer1 && !isPlayer2) {
            reply(`${character}, you're not in this fight!`);
            return;
        }

        const loser = isPlayer1 ? gs.player1 : gs.player2;
        const winner = isPlayer1 ? gs.player2 : gs.player1;

        // Update records
        await recordMatchResult(winner.displayName, loser.displayName);

        reply(`[b]${loser.displayName}[/b] has forfeited!
[b]🏆 ${winner.displayName} WINS BY FORFEIT! 🏆[/b]`);

        context.gameState = null;
        leaveDynamicRoomIfNeeded(client, channel, context);
    },

    /**
     * !endfight - End the current fight (admin/reset)
     */
    endfight: async ({ context, client, channel, reply }) => {
        if (!context.gameState && !context.challengeState) {
            reply('No fight or challenge to reset.');
            return;
        }

        context.gameState = null;
        context.challengeState = null;
        context.pendingRolls = {};
        reply('Fight has been ended and the arena has been reset.');
        leaveDynamicRoomIfNeeded(client, channel, context);
    },

    /**
     * !clubhelp - Show help
     */
    clubhelp: async ({ reply }) => {
        reply(`[b]═══ DICE COMBAT COMMANDS ═══[/b]

[b]Setup:[/b]
[b]!clubregister[/b] - Register to play
[b]!setheight <feet>[/b] - Set height for size modifiers (e.g., 5.5 = 5'6")
[b]!setbodytype <type>[/b] - Set body type (fat, thicc, average, toned, buff)
[b]!clubstats [player][/b] - View combat record

[b]Fighting:[/b]
[b]!challenge <player>[/b] - Challenge someone
[b]!accept / !decline[/b] - Respond to challenge (creates a private room)
[b]!roll[/b] - Roll d20 (initiative or combat)
[b]!stun[/b] - Attempt high-risk stun move
[b]!status[/b] - View current fight status
[b]!forfeit[/b] - Give up the fight
[b]!endfight[/b] - Reset the arena

[b]Phases:[/b] Struggle → Strip/Pin → Penetration → Fuck 1 → Fuck 2 → Climax

[b]Rules:[/b]
• Highest roll wins (ties go to defender)
• Roll 1 = auto-lose + skip an extra phase
• Roll 20+ total = crit (impossible if debuffs make 20 unreachable)
• Accepted challenges create a private fight room
• Size & streak modifiers apply automatically`);
    },

    /**
     * !clubrules - Show detailed rules
     */
    clubrules: async ({ reply }) => {
        reply(`[b]═══ DICE COMBAT RULES ═══[/b]

[b]Roll Mechanics:[/b]
• Ties: Defender wins
• Both roll 1: Wash (no effect, reroll)
• Both roll nat 20: Defender wins
• Critical (20+ total): Auto-wins unless opponent also crits
• Nat 1: Auto-lose AND skip an extra phase (double punishment)
• Can't crit if debuffs make it impossible to reach 20

[b]Phases:[/b]
1. Struggle/Grapple - Win: Phase 2, Lose: Swap attacker
2. Strip/Pin - Win: Phase 3, Lose: Phase 1 (Pin only if already naked)
3. Penetration - Win: Phase 4 (+debuff), Lose: Phase 2
4. Fuck Check 1 - Win: Phase 5 (+debuff), Lose: Phase 3
5. Fuck Check 2 - Win: Phase 6 (+debuff), Lose: Phase 4
6. Climax - Win: VICTORY, Lose: Phase 5

[b]Modifiers:[/b]
• Size (attack only): 1-2ft diff = ±1, >2ft = ±2
• Body type: Fat/Chubby, Thicc/Curvy, Average, Toned, Buff
• Win streak: 2=+1, 3=+2, 4+=+3
• Loss streak: 2=-1, 3=-2, 4+=-3

[b]Stuns:[/b]
High-risk move. Success skips a phase and gives -2 debuff.
Failure: If clothed, stripped + Phase 3. If naked, Phase 4.
If already at Phase 3+, skip one phase forward.`);
    }
};

/**
 * Apply stun success
 * Successful stun: skip one phase ahead AND apply -2 debuff to defender.
 * If Phase 2 is being passed through, strip the defender (if clothed) or just pin (if naked).
 */
async function applyStunSuccess(gs, attacker, defender) {
    let msg = '';

    // Stun skips a phase - advance TWO phases from current
    const currentPhase = gs.phase;
    let firstAdvance = PHASES[currentPhase].winAdvance;

    if (firstAdvance === null) {
        // Already at climax - win!
        gs.finished = true;
        gs.winner = attacker;
        gs.loser = defender;
        await recordMatchResult(attacker.displayName, defender.displayName);
        msg += `${defender.displayName} is stunned at the Climax phase!\n`;
        msg += `[b]🏆 ${attacker.displayName} WINS! 🏆[/b]`;
    } else {
        // Get the phase after the first advance (skip one phase)
        let targetPhase = PHASES[firstAdvance].winAdvance;

        // If first advance passes through Phase 2, handle strip/pin
        if (firstAdvance === 2) {
            if (defender.clothed) {
                defender.clothed = false;
                msg += `[color=yellow]${defender.displayName} has been stripped![/color]\n`;
            } else {
                msg += `[color=yellow]${defender.displayName} is already naked - pinned down![/color]\n`;
            }
        }

        // Apply debuffs from the skipped-through phase if applicable
        if (PHASES[firstAdvance].winDefenderDebuff) {
            defender.battleDebuff = (defender.battleDebuff || 0) + PHASES[firstAdvance].winDefenderDebuff;
            msg += `[color=red]${defender.displayName} gains ${PHASES[firstAdvance].winDefenderDebuff} from skipped phase![/color]\n`;
        }

        // If target is null, we've passed the climax = victory
        if (targetPhase === null) {
            gs.finished = true;
            gs.winner = attacker;
            gs.loser = defender;
            await recordMatchResult(attacker.displayName, defender.displayName);
            msg += `${defender.displayName} is stunned past the Climax phase!\n`;
            msg += `[b]🏆 ${attacker.displayName} WINS! 🏆[/b]`;
            return msg;
        }

        // Phase 2 is NOT skipped as a target - it converts to Pin if defender is naked

        gs.phase = targetPhase;
        defender.battleDebuff = (defender.battleDebuff || 0) - 2;
        msg += `${defender.displayName} is stunned! Skipping to Phase ${targetPhase}: ${PHASES[targetPhase].name}\n`;
        msg += `[color=red]${defender.displayName} gains -2 to all rolls![/color]`;
    }

    return msg;
}

/**
 * Apply stun failure
 * Rules:
 * - If clothed: stripped (clothed=false) AND sent to Phase 3 (penetration) on defense
 * - If naked: sent to Phase 4 (fuck check 1) on defense
 * - If already in a vulnerable stage (phase 3+): skip one phase forward
 * - Always swap attacker (no debuff applied)
 */
function applyStunFailure(gs, attacker, defender) {
    let msg = '';

    if (attacker.clothed) {
        // Clothed: get stripped AND go to Phase 3
        attacker.clothed = false;
        gs.phase = 3;
        msg += `${attacker.displayName}'s stun fails! They are stripped and left vulnerable to penetration!\n`;
        msg += `[color=yellow]${attacker.displayName} has been stripped![/color]\n`;
    } else if (gs.phase >= 3) {
        // Already in a vulnerable stage (phase 3+): skip one phase forward
        let targetPhase = gs.phase + 1;
        if (targetPhase > 6) targetPhase = 6;
        if (targetPhase === 6) {
            // Landing on climax
            gs.phase = 6;
            msg += `${attacker.displayName}'s stun fails catastrophically! Pushed to the Climax phase!\n`;
        } else {
            gs.phase = targetPhase;
            msg += `${attacker.displayName}'s stun fails! Pushed forward to Phase ${gs.phase}: ${PHASES[gs.phase].name}!\n`;
        }
    } else {
        // Naked but not yet at phase 3+: go to Phase 4
        gs.phase = 4;
        msg += `${attacker.displayName}'s stun fails! Already naked - pushed to Fuck Check!\n`;
    }

    // Failed stun applies -2 debuff to the attacker
    attacker.battleDebuff = (attacker.battleDebuff || 0) - 2;
    msg += `[color=red]${attacker.displayName} gains -2 to all rolls from the failed stun![/color]\n`;

    // Swap attacker
    gs.currentAttacker = gs.currentAttacker === 1 ? 2 : 1;
    msg += `[b]${defender.displayName} is now the attacker![/b]`;

    return msg;
}
