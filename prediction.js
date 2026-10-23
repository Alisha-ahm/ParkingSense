/**
 * ParkSense - Peak-Hour Prediction Module
 * Forecasting algorithm using a Weighted Moving Average (WMA) of historical occupancy
 * partitioned by Day of Week and Hour of Day.
 */

import { Storage } from './storage.js';

export const PredictionEngine = {
  /**
   * Forecasts parking occupancy for a specific day of week (0=Sun, 1=Mon...6=Sat) and hour (0-23).
   *
   * ALGORITHM & TIME COMPLEXITY:
   * 1. Filters historical records matching the target dayOfWeek and hour: O(H) where H is total history records.
   * 2. Sorts records chronologically (most recent first): O(K log K) where K <= 10.
   * 3. Applies linear decay weights W = [0.45, 0.30, 0.15, 0.10] to the most recent K observations.
   * 4. Computes Weighted Moving Average: sum(W_i * Occ_i) / sum(W_i).
   * 5. Computes sample variance to establish the statistical confidence score.
   *
   * Overall Time Complexity: O(H) where H is fixed (e.g. 168 hours in 7 days), effectively O(1).
   * Space Complexity: O(K) where K is matching sample count.
   *
   * @param {number} dayOfWeek 0 to 6
   * @param {number} targetHour 0 to 23
   * @returns {Object} Forecast results with predicted occupancy %, classification, and confidence.
   */
  predictOccupancy(dayOfWeek, targetHour) {
    const history = Storage.getAnalyticsHistory();
    const matching = history.filter(
      (item) => item.dayOfWeek === dayOfWeek && item.hour === targetHour
    );

    // If no exact match (cold start), construct reasonable fallback baseline
    if (matching.length === 0) {
      return this._fallbackBaseline(dayOfWeek, targetHour);
    }

    // Sort most recent first (lowest dayOffset first)
    matching.sort((a, b) => a.dayOffset - b.dayOffset);

    // Exponential/linear decay weights for up to 4 historical samples
    const baseWeights = [0.45, 0.3, 0.15, 0.1];
    let weightedSum = 0;
    let weightTotal = 0;
    const values = [];

    matching.forEach((record, index) => {
      const weight = baseWeights[index] || 0.05;
      weightedSum += record.occupancyRate * weight;
      weightTotal += weight;
      values.push(record.occupancyRate);
    });

    const predictedRate = Math.round(weightedSum / (weightTotal || 1));

    // Calculate Variance and Standard Deviation for Confidence Score
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
    const variance =
      values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length || 1);
    const stdDev = Math.sqrt(variance);

    // Confidence: High when sample variance is low and sample size is adequate
    // Range: 65% to 96%
    const sampleFactor = Math.min(1.0, values.length / 3);
    const confidence = Math.min(
      96,
      Math.max(68, Math.round((100 - stdDev * 1.8) * sampleFactor + 25 * (1 - sampleFactor)))
    );

    // Classification
    let demandLevel = 'Moderate';
    let statusBadge = 'Likely Spots Available';
    let urgencyColor = 'emerald';

    if (predictedRate >= 85) {
      demandLevel = 'Peak Rush';
      statusBadge = 'Likely FULL / High Delay';
      urgencyColor = 'rose';
    } else if (predictedRate >= 70) {
      demandLevel = 'High Demand';
      statusBadge = 'Limited Slots Left';
      urgencyColor = 'amber';
    } else if (predictedRate <= 35) {
      demandLevel = 'Low Demand';
      statusBadge = 'Plentiful Slots (Off-Peak)';
      urgencyColor = 'emerald';
    }

    // Recommended arrival window: Scan adjacent hours [-2h, +2h]
    const recommendedWindow = this._findBestWindow(dayOfWeek, targetHour, history);

    return {
      dayOfWeek,
      targetHour,
      timeFormatted: this._formatHour(targetHour),
      predictedRate,
      predictedSlotsOccupied: Math.round((predictedRate / 100) * 60),
      totalSlots: 60,
      demandLevel,
      statusBadge,
      urgencyColor,
      confidence,
      samplesAnalyzed: matching.length,
      recommendedWindow,
    };
  },

  /**
   * Scans adjacent hour intervals to suggest the lowest-occupancy alternative window.
   */
  _findBestWindow(dayOfWeek, centerHour, history) {
    const candidates = [];
    for (let offset = -2; offset <= 3; offset++) {
      const h = (centerHour + offset + 24) % 24;
      const records = history.filter((item) => item.dayOfWeek === dayOfWeek && item.hour === h);
      const avgRate =
        records.length > 0
          ? records.reduce((s, r) => s + r.occupancyRate, 0) / records.length
          : 50;
      candidates.push({ hour: h, rate: avgRate });
    }

    candidates.sort((a, b) => a.rate - b.rate);
    const best = candidates[0];
    const bestHourStr = this._formatHour(best.hour);
    const nextHourStr = this._formatHour((best.hour + 1) % 24);

    return `${bestHourStr} – ${nextHourStr} (~${Math.round(best.rate)}% occupancy)`;
  },

  _formatHour(h) {
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    return `${displayHour}:00 ${period}`;
  },

  _fallbackBaseline(dayOfWeek, hour) {
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    let rate = 30;
    if (hour >= 8 && hour <= 10) rate = isWeekend ? 40 : 75;
    else if (hour >= 12 && hour <= 14) rate = isWeekend ? 65 : 82;
    else if (hour >= 17 && hour <= 19) rate = isWeekend ? 78 : 88;
    else if (hour >= 20 && hour <= 22) rate = isWeekend ? 60 : 45;

    return {
      dayOfWeek,
      targetHour: hour,
      timeFormatted: this._formatHour(hour),
      predictedRate: rate,
      predictedSlotsOccupied: Math.round((rate / 100) * 60),
      totalSlots: 60,
      demandLevel: rate > 75 ? 'High Demand' : 'Moderate',
      statusBadge: rate > 75 ? 'Limited Slots Left' : 'Spots Available',
      urgencyColor: rate > 75 ? 'amber' : 'emerald',
      confidence: 74,
      samplesAnalyzed: 0,
      recommendedWindow: '14:00 – 15:00 (~45% occupancy)',
    };
  },

  /**
   * Generates a 24-hour forecast curve for the specified day of week.
   */
  get24HourForecast(dayOfWeek) {
    const curve = [];
    for (let h = 0; h < 24; h++) {
      curve.push(this.predictOccupancy(dayOfWeek, h));
    }
    return curve;
  },
};
