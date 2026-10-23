/**
 * ParkSense - Billing Module
 * Rule-Chaining Fee Calculation Engine and Payment Processing.
 * Computes duration, grace period, vehicle type rates, daily caps,
 * night discounts, overstay penalties, lost-ticket fines, and dynamic surge pricing.
 */

import { Storage } from './storage.js';

export const BillingEngine = {
  /**
   * Retrieves current dynamic surge pricing status based on overall occupancy.
   *
   * RULES:
   * - Occupancy > 80%: Surge +20% (multiplier 1.20)
   * - Occupancy < 30%: Off-Peak -10% (multiplier 0.90)
   * - 30% - 80%: Standard Rates (multiplier 1.00)
   *
   * Time Complexity: O(N) to count occupied slots across N=60 slots.
   */
  getSurgeStatus() {
    const slots = Storage.getSlots();
    const total = slots.length || 60;
    const occupied = slots.filter(
      (s) => s.status === 'occupied' || s.status === 'ev_charging'
    ).length;
    const occupancyRate = Math.round((occupied / total) * 100);

    const settings = Storage.getSettings();
    const highThreshold = settings.surgeThresholdHigh ?? 80;
    const lowThreshold = settings.surgeThresholdLow ?? 30;

    let multiplier = 1.0;
    let label = 'Standard Rate';
    let type = 'normal'; // 'surge' | 'discount' | 'normal'
    let percentDelta = 0;

    if (occupancyRate >= highThreshold) {
      multiplier = settings.surgeMultiplierHigh ?? 1.2;
      percentDelta = Math.round((multiplier - 1) * 100);
      label = `Surge Active (+${percentDelta}%)`;
      type = 'surge';
    } else if (occupancyRate <= lowThreshold) {
      multiplier = settings.surgeMultiplierLow ?? 0.9;
      percentDelta = Math.round((1 - multiplier) * 100);
      label = `Off-Peak Discount (-${percentDelta}%)`;
      type = 'discount';
    }

    return {
      occupancyRate,
      occupied,
      total,
      multiplier,
      label,
      type,
      percentDelta,
    };
  },

  /**
   * Calculates the proportion of time (in hours) spent during night discount hours (10:00 PM - 06:00 AM).
   * Supports cross-day intervals.
   */
  calculateNightHours(entryTime, exitTime) {
    let nightHours = 0;
    const stepMs = 15 * 60 * 1000; // 15-minute sampling steps

    for (let t = entryTime; t < exitTime; t += stepMs) {
      const currentHour = new Date(t).getHours();
      // Night is between 22:00 (10 PM) and 06:00 (6 AM)
      if (currentHour >= 22 || currentHour < 6) {
        nightHours += 0.25;
      }
    }

    return Math.min(nightHours, (exitTime - entryTime) / (3600 * 1000));
  },

  /**
   * Fee Calculation Engine with Rule Chaining.
   *
   * ALGORITHM & TIME COMPLEXITY:
   * Evaluates sequential business rules with constant-time math:
   * Rule 1: Duration & Grace period evaluation -> O(1)
   * Rule 2: Base hourly rate multiplication -> O(1)
   * Rule 3: Night hour discount calculation -> O(H) where H is hours parked (typically 1-24)
   * Rule 4: 24-hour daily maximum cap clamp -> O(1)
   * Rule 5: Dynamic surge multiplier application -> O(1)
   * Rule 6: Overstay penalty inspection & addition -> O(1)
   * Rule 7: Lost-ticket fine addition -> O(1)
   * Overall Time Complexity: O(1) amortized.
   *
   * @param {Object} options
   * @param {number} options.entryTime Milliseconds timestamp
   * @param {number} [options.exitTime] Milliseconds timestamp (defaults to Date.now())
   * @param {string} options.vehicleType 'bike' | 'car' | 'suv' | 'ev'
   * @param {boolean} [options.isLostTicket=false]
   * @returns {Object} Comprehensive itemized fee receipt
   */
  calculateFee({ entryTime, exitTime = Date.now(), vehicleType = 'car', isLostTicket = false }) {
    const settings = Storage.getSettings();
    const elapsedMs = Math.max(0, exitTime - entryTime);
    const totalMinutes = Math.ceil(elapsedMs / (60 * 1000));
    const totalHoursRaw = elapsedMs / (3600 * 1000);
    // Standard rounding to nearest billing increment (ceil to whole hour after grace)
    const billableHours = Math.max(1, Math.ceil(totalHoursRaw));

    const rate = settings.rates[vehicleType] || settings.rates.car || 3.0;
    const dailyCap = settings.dailyCaps[vehicleType] || settings.dailyCaps.car || 25.0;
    const graceMinutes = settings.gracePeriodMinutes || 10;
    const surge = this.getSurgeStatus();

    // Itemized breakdown accumulator
    const breakdown = {
      entryTime,
      exitTime,
      totalMinutes,
      totalHoursRaw: Math.round(totalHoursRaw * 10) / 10,
      billableHours,
      vehicleType,
      baseRatePerHour: rate,
      dailyCap,
      gracePeriodMinutes: graceMinutes,
      graceApplied: false,
      baseSubtotal: 0,
      dailyCapDiscount: 0,
      nightHours: 0,
      nightDiscountAmount: 0,
      surgeMultiplier: surge.multiplier,
      surgeAdjustmentAmount: 0,
      overstayHours: 0,
      overstayPenalty: 0,
      lostTicketFine: isLostTicket ? (settings.lostTicketFine || 30.0) : 0,
      finalTotal: 0,
    };

    // If lost ticket without entry record
    if (isLostTicket && !entryTime) {
      breakdown.finalTotal = settings.lostTicketFine || 30.0;
      return breakdown;
    }

    // RULE 1: Grace Period
    // Vehicles leaving within 10 minutes are 100% free
    if (totalMinutes <= graceMinutes && !isLostTicket) {
      breakdown.graceApplied = true;
      breakdown.finalTotal = 0.0;
      return breakdown;
    }

    // RULE 2: Base hourly calculation with Day-Cap logic
    // Handles multi-day stays (e.g. 28 hours = 1 full day capped + 4 hours)
    const fullDays = Math.floor(billableHours / 24);
    const remainingHours = billableHours % 24;

    const uncappedRemainder = remainingHours * rate;
    const cappedRemainder = Math.min(uncappedRemainder, dailyCap);
    const rawSubtotal = fullDays * dailyCap + cappedRemainder;

    const pureUncapped = billableHours * rate;
    breakdown.baseSubtotal = rawSubtotal;
    if (pureUncapped > rawSubtotal) {
      breakdown.dailyCapDiscount = Math.round((pureUncapped - rawSubtotal) * 100) / 100;
    }

    // RULE 3: Night Hours Discount
    // 20% discount on hours parked between 22:00 and 06:00
    const nightHours = this.calculateNightHours(entryTime, exitTime);
    breakdown.nightHours = Math.round(nightHours * 10) / 10;
    if (nightHours > 0) {
      const discountPercent = (settings.nightDiscountPercent || 20) / 100;
      const nightSavings = Math.round(nightHours * rate * discountPercent * 100) / 100;
      breakdown.nightDiscountAmount = Math.min(nightSavings, breakdown.baseSubtotal * 0.4);
    }

    let subtotalAfterNight = Math.max(0, breakdown.baseSubtotal - breakdown.nightDiscountAmount);

    // RULE 4: Dynamic Surge Pricing
    if (surge.multiplier !== 1.0) {
      const adjusted = subtotalAfterNight * surge.multiplier;
      breakdown.surgeAdjustmentAmount = Math.round((adjusted - subtotalAfterNight) * 100) / 100;
      subtotalAfterNight = adjusted;
    }

    // RULE 5: Overstay Penalty
    // If parked longer than threshold (e.g. 12 hours)
    const overstayThreshold = settings.overstayThresholdHours || 12;
    if (totalHoursRaw > overstayThreshold) {
      breakdown.overstayHours = Math.round((totalHoursRaw - overstayThreshold) * 10) / 10;
      breakdown.overstayPenalty = settings.overstayPenaltyFlat || 10.0;
    }

    // RULE 6: Lost Ticket Fine
    const lostFine = isLostTicket ? (settings.lostTicketFine || 30.0) : 0;

    // RULE 7: Total Summation
    const finalTotal = subtotalAfterNight + breakdown.overstayPenalty + lostFine;
    breakdown.finalTotal = Math.max(0, Math.round(finalTotal * 100) / 100);

    return breakdown;
  },

  /**
   * Finalizes vehicle checkout, records payment, releases slot, and updates history.
   *
   * @param {Object} paymentData
   * @param {string} paymentData.ticketId
   * @param {string} paymentData.paymentMethod 'cash' | 'card' | 'wallet'
   * @param {boolean} [paymentData.isLostTicket=false]
   * @returns {Object} Complete payment record and receipt
   */
  processCheckout({ ticketId, paymentMethod = 'card', isLostTicket = false }) {
    const ticketMap = Storage.getTicketMap();
    const activeTicket = ticketMap.get(ticketId);

    if (!activeTicket && !isLostTicket) {
      throw new Error(`Active ticket ${ticketId} not found.`);
    }

    const now = Date.now();
    const entryTime = activeTicket ? activeTicket.entryTime : now - 2 * 3600 * 1000;
    const vehicleType = activeTicket ? activeTicket.type : 'car';
    const plate = activeTicket ? activeTicket.plate : 'UNKNOWN';
    const slotId = activeTicket ? activeTicket.slotId : 'N/A';
    const floor = activeTicket ? activeTicket.floor : 1;

    // Calculate itemized fee
    const feeCalculation = this.calculateFee({
      entryTime,
      exitTime: now,
      vehicleType,
      isLostTicket,
    });

    const receiptId = `RCP-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const historyRecord = {
      id: receiptId,
      ticketId: activeTicket ? activeTicket.ticketId : `LOST-${Date.now()}`,
      slotId,
      floor,
      plate,
      type: vehicleType,
      entryTime,
      exitTime: now,
      durationHours: feeCalculation.totalHoursRaw,
      fee: feeCalculation.finalTotal,
      feeBreakdown: feeCalculation,
      paymentMethod,
      status: 'completed',
      paidAt: now,
    };

    // 1. Release slot
    if (slotId && slotId !== 'N/A') {
      Storage.updateSlot(slotId, {
        status: 'free',
        currentVehicle: null,
      });
    }

    // 2. Remove active ticket
    if (activeTicket) {
      Storage.removeTicket(activeTicket.ticketId);
    }

    // 3. Add to completed history
    Storage.addHistory(historyRecord);

    // 4. Record notification
    Storage.addNotification({
      type: 'success',
      title: 'Payment Received',
      message: `Received $${feeCalculation.finalTotal.toFixed(2)} via ${paymentMethod.toUpperCase()} for ${plate} (Slot ${slotId}).`,
    });

    return historyRecord;
  },
};
