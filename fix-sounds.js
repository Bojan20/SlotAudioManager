const fs = require('fs');
const p = 'c:/IGT/love-island-audio/sounds.json';
const json = JSON.parse(fs.readFileSync(p, 'utf8'));
const cmds = json.soundDefinitions.commands;
const spriteKeys = new Set(Object.keys(json.soundDefinitions.soundSprites));

const map = {
  's_BaseMusicLoop': 's_BaseGameMusicLoop',
  's_BigWinStart': 's_BigWinLoop',
  's_BigWinEnd': 's_BigWinLoopTerm',
  's_BonusMusicLoop': 's_BonusGameMusicLoop1a',
  's_BonusMusicLoopEnd': 's_BonusGameEnd',
  's_Rollup1': 's_Rollup',
  's_Rollup1End': 's_RollupEnd',
  's_BonusRollupStart': 's_BonusLevel1Rollup',
  's_BonusRollupEnd': 's_BonusLevel1RollupTerminator',
  's_ReelLand': 's_ReelLand1',
  's_SymbolB01Land1': 's_BonusSymbolLand1',
  's_SymbolB01Land2': 's_BonusSymbolLand2',
  's_SymbolB01Land3': 's_BonusSymbolLand3',
  's_SymbolB01Land4': 's_BonusSymbolLand4',
  's_SymbolB01Land5': 's_BonusSymbolLand5',
  's_PreBonusLoop': 's_PreCog',
  's_UiSkip': 's_UiStop',
  's_UiSpinSlam': 's_UiStop',
};

let replaced = 0;
let stillMissing = new Set();

for (const [cmdName, actions] of Object.entries(cmds)) {
  for (const action of actions) {
    if (!action.spriteId) continue;
    if (map[action.spriteId]) {
      const old = action.spriteId;
      action.spriteId = map[old];
      replaced++;
      console.log(`  ${cmdName}: ${old} -> ${action.spriteId}`);
    } else if (!spriteKeys.has(action.spriteId)) {
      stillMissing.add(action.spriteId);
    }
  }
}

fs.writeFileSync(p, JSON.stringify(json, null, 4));
console.log(`\n=== DONE ===`);
console.log(`Replaced: ${replaced}`);
console.log(`Still missing (no WAV exists): ${stillMissing.size}`);
if (stillMissing.size > 0) {
  for (const m of [...stillMissing].sort()) console.log(`  ${m}`);
}
