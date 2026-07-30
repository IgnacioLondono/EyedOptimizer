/**
 * Compat: temp CPU Lenovo → agente privilegiado unificado (priv-agent.cjs).
 * 1 UAC al instalar; luego sin más prompts.
 */
module.exports = require('./priv-agent.cjs')
