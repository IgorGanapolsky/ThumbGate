#!/usr/bin/env node
'use strict';
const { computeToolKpis, getAtRiskTools } = require('./tool-kpi-tracker');
const { checkSloViolations } = require('./slo-alert-engine');
const { computeAccessStats, detectAnomalies } = require('./access-anomaly-detector');
function getStatuslineTowerData({ periodHours = 24 } = {}) { const kpis = computeToolKpis({ periodHours }); const sloCheck = checkSloViolations({ periodHours }); const accessStats = computeAccessStats({ periodHours }); const anomalyCheck = detectAnomalies({ baselineHours: 168, recentHours: periodHours }); return { totalToolCalls: kpis.totalCalls, serverCount: kpis.servers.length, atRiskToolCount: getAtRiskTools({ periodHours }).length, sloViolations: sloCheck.violationCount, worstTool: sloCheck.violations.length > 0 ? sloCheck.violations[0].toolName : null, accessTotal: accessStats.total, accessFailed: accessStats.failed, accessFailRate: accessStats.failRate, anomalyCount: anomalyCheck.anomalies.length, hasAnomalies: anomalyCheck.hasAnomalies }; }
if (require.main === module) { try { process.stdout.write(JSON.stringify(getStatuslineTowerData())); } catch (e) { process.stdout.write(JSON.stringify({ error: e.message })); } }
module.exports = { getStatuslineTowerData };
