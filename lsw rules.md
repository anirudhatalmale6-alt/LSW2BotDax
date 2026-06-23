Players need to !register in the room to use LSW commands.
Their username and player stats are stored on a database.
Database is mongodb, right now is locally hosted, save it on the lsw collection.
When a player registers, they have these stats:
- username (string)
- lips attack
- fingers attack
- chest attack
- body attack
- feet attack
- lips defense
- fingers defense
- chest defense
- body defense
- feet defense
- training points (starts at 15)

All attack and defense stats start at 1.
Players have 15 points to distribute among their attack and defense stats when they register.
Each stat can have a maximum of 5 points.

Any user can !ready and that sets them up on a stage (a gamestate of the room)
Then a second user does !ready and the battle starts.

The battle is turn based, each player can !attack <part> to <part>
Where <part> is one of: lips, fingers, chest, body, feet
The attack stat of the attacking part is compared to the defense stat of the defending part.
The damage is calculated as:
damage = attacker's attack stat - defender's defense stat + 2d6
If damage is less than or equal to 0, the damage is set to 1.

Each player starts with 50 HP.
When a player's HP reaches 0, they lose the battle.

After each player's attack, the turn switches to the other player, then a status display shows up:

Player 1 used their <part> to attack Player 2's <part>, dealing XX damage!
<color=pink>█████</color><color=gray>█████</color>    <color=pink>█████</color><color=gray>█████</color>
<icon>Player1Name</icon> HP: XX/50 vs <icon>Player2Name</icon> HP: XX/50
It's Player 2's turn!

Commands:
!register - Registers the player and allows them to distribute their stats.
!train <attack/defense> on <part> - Increases a specific stat by spending training points.
!indulge <attack/defense> on <part> - Decreases a specific stat to regain training points.
!stats - Shows the player's current stats.
!ready - Sets the player as ready for battle.
!attack <part> to <part> - Attacks the specified part of the opponent.
!status - Shows the current status of the battle.
!giveup - Forfeits the current battle.
!endbattle - Ends the current battle and resets the gamestate (this also happens when a fight ends).

