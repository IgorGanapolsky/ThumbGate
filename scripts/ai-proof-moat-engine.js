/**
 * AI-Proof Business Moat & Outcome Stacking Engine
 * 
 * Based on Greg Isenberg's 8 Defensive Business Plays ("If You Want To Create Wealth In The Age of AI"):
 * 1. Permission & Regulatory Moats (Licensed credentials, Preferred Enterprise Vendor status)
 * 2. Physical & Atoms Moats (Local service infrastructure, physical assets)
 * 3. AI-Amplified Trend Monitoring & Micro-Niche Scanners
 * 4. Micro-Niche Media & High-Volume Founder-Led Video
 * 5. Curated High-Signal Directories & Proprietary Datasets (Anti-Slop)
 * 6. Lean Agent-Operated Marketplaces with Sticky Transaction Mechanics
 * 7. Paid Accountability Communities & Real-Life/Virtual Events (Skool / Meetups)
 * 8. Stacking Moats for Defensible Automated Outcomes (Rule: Never offer single-category outcome agency)
 */

'use strict';

const DEFENSIVE_MOAT_CATEGORIES = {
  PERMISSION_REGULATORY: 'PERMISSION_REGULATORY',
  PHYSICAL_ATOMS: 'PHYSICAL_ATOMS',
  TREND_MONITORING: 'TREND_MONITORING',
  MICRO_NICHE_MEDIA: 'MICRO_NICHE_MEDIA',
  CURATED_PROPRIETARY_DATA: 'CURATED_PROPRIETARY_DATA',
  AGENT_OPERATED_MARKETPLACE: 'AGENT_OPERATED_MARKETPLACE',
  COMMUNITY_AND_EVENTS: 'COMMUNITY_AND_EVENTS',
  STACKED_AUTOMATED_OUTCOME: 'STACKED_AUTOMATED_OUTCOME'
};

class AiProofMoatEngine {
  constructor() {
    this.activeMoats = new Map();
    this.registeredPartnerships = [];
    this.trendAlerts = [];
  }

  /**
   * Register a company moat capability into the audit inventory.
   */
  registerMoat(category, details) {
    if (!DEFENSIVE_MOAT_CATEGORIES[category]) {
      throw new Error(`[MoatEngine] Invalid moat category: ${category}`);
    }
    this.activeMoats.set(category, {
      category,
      details,
      registeredAt: new Date().toISOString()
    });
    return this.activeMoats.get(category);
  }

  /**
   * Evaluates the defensibility of an offer or business unit.
   * Invariant: A business model relying solely on automated outcome delivery
   * has zero defensibility without stacking >= 2 foundational moats.
   */
  evaluateOfferDefensibility(offer) {
    const { name, categories = [], targetPriceUsd } = offer;

    const matchedMoats = categories.filter(cat => this.activeMoats.has(cat));
    const isSingleOutcomeOnly = categories.length === 1 && categories.includes(DEFENSIVE_MOAT_CATEGORIES.STACKED_AUTOMATED_OUTCOME);

    let defensibilityTier = 'WEAK';
    let recommendations = [];

    if (isSingleOutcomeOnly || matchedMoats.length < 2) {
      defensibilityTier = 'VULNERABLE_TO_CLONING';
      recommendations.push(
        'Pure automated outcome agencies are easily duplicated by competitor agents.',
        'Stack at least two foundational moats: e.g. Permission/Vendor Status + Proprietary Data, or Media Attention + Paid Community.'
      );
    } else if (matchedMoats.length >= 2 && matchedMoats.length < 4) {
      defensibilityTier = 'DEFENSIBLE';
      recommendations.push('Strong defensibility. Maintain exclusive vendor status and accelerate community engagement.');
    } else {
      defensibilityTier = 'HIGH_MOAT_FORTRESS';
      recommendations.push('Exceptional defensibility. Multiple interlocking barriers protect cash flow.');
    }

    return {
      offerName: name,
      targetPriceUsd,
      moatCount: matchedMoats.length,
      matchedMoats,
      defensibilityTier,
      isCompliant: defensibilityTier !== 'VULNERABLE_TO_CLONING',
      recommendations
    };
  }

  /**
   * Register verified enterprise vendor or ecosystem partnerships (e.g. NVIDIA Inception, Crusoe Cloud).
   */
  registerEnterprisePartnership(partner) {
    const record = {
      partnerName: partner.name,
      ecosystem: partner.ecosystem,
      benefits: partner.benefits || [],
      verified: partner.verified !== false,
      timestamp: Date.now()
    };
    this.registeredPartnerships.push(record);
    this.registerMoat(DEFENSIVE_MOAT_CATEGORIES.PERMISSION_REGULATORY, {
      type: 'ENTERPRISE_VENDOR_PARTNERSHIP',
      partners: this.registeredPartnerships
    });
    return record;
  }

  /**
   * Automated micro-niche trend scan analyzer.
   */
  ingestTrendSignal(signal) {
    const alert = {
      niche: signal.niche,
      growthVelocity: signal.growthVelocity || 'RISING',
      firstMoverWindowDays: signal.firstMoverWindowDays || 14,
      actionablePlay: signal.actionablePlay,
      scannedAt: new Date().toISOString()
    };
    this.trendAlerts.push(alert);
    return alert;
  }
}

module.exports = {
  AiProofMoatEngine,
  DEFENSIVE_MOAT_CATEGORIES
};
