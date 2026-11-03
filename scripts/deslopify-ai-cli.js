#!/usr/bin/env node
'use strict';

const {
  evaluateHowToDeslopifyYourAiSteal,
  evaluateRobertHerjavecBillionDollarSalesEngine,
  evaluateYouSpotProPayFirstAndSoloBrainSteal,
  evaluateHkustHarnessSqlAndDshSqlSteal,
  evaluateZouMollickLlmClaimsShelfLifeSteal,
  evaluateSoftMtpKlGradientRecoverySteal,
  evaluateJulianGoldieAiMoneyLabSkoolMonetizer,
  evaluateJulianGoldieGrokBotJarvisCommandCenter,
  evaluateQwenGpuCompiledSimtAndDeltaNetStateSteal,
  evaluateLinkedInOpenTelemetryJourneySteal,
  evaluateGrokDataBotAndBroadStickyTeamBotsSteal,
} = require('../src/cloud-token-firewall');

function main() {
  const summary = {
    ok: true,
    deslopifyAi: evaluateHowToDeslopifyYourAiSteal(),
    herjavecSalesEngine: evaluateRobertHerjavecBillionDollarSalesEngine(),
    youspotPro: evaluateYouSpotProPayFirstAndSoloBrainSteal(),
    hkustHarnessSql: evaluateHkustHarnessSqlAndDshSqlSteal(),
    llmClaimsShelfLife: evaluateZouMollickLlmClaimsShelfLifeSteal(),
    softMtpKlRecovery: evaluateSoftMtpKlGradientRecoverySteal(),
    julianGoldieSkool: evaluateJulianGoldieAiMoneyLabSkoolMonetizer(),
    jarvisCommandCenter: evaluateJulianGoldieGrokBotJarvisCommandCenter(),
    qwenGpuSimt: evaluateQwenGpuCompiledSimtAndDeltaNetStateSteal(),
    linkedInOtelJourney: evaluateLinkedInOpenTelemetryJourneySteal(),
    grokDataBot: evaluateGrokDataBotAndBroadStickyTeamBotsSteal(),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
