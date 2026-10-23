# ParkSense: Smart Parking Management System

**ParkSense** is a Single Page Application (SPA) designed with pure HTML5, modern CSS, and vanilla JavaScript (no third-party frameworks or graphing libraries). It addresses urban parking friction by automating slot allocation, billing with rule chaining, reservation collision checking, and peak-hour forecasting using local browser persistence (`localStorage`).

---

## 📂 Folder Structure

```
├── index.html         # Application shell, responsive dashboard layout, modals, and templates
├── style.css          # CSS custom variables, dark/light themes, animations, glassmorphism & print rules
├── storage.js         # LocalStorage database layer, seed data generator, and O(1) hash maps
├── parking.js         # Min-Heap nearest slot allocator, collision detector & Canvas QR generator
├── billing.js         # Rule-chaining fee calculation engine, dynamic surge pricing & checkout
├── prediction.js      # Weighted Moving Average (WMA) peak-hour forecasting & confidence scoring
├── charts.js          # Pure HTML5 Canvas charts (Hourly Line, Daily Revenue, Donut, Heatmap)
├── ui.js              # DOM rendering, KPI count-up, slot grid, car animations & toast alerts
├── app.js             # Application coordinator, forms, timers & traffic simulation loop
├── metadata.json      # Applet metadata
└── README.md          # Documentation, data models, algorithms & run instructions
```

---

## 🚀 Key Features

1. **User Role Profiles (Simulated)**:
   - **Admin**: Manages pricing policies, system rules, views full analytics, exports CSV reports, and resets demo data.
   - **Attendant**: Handles vehicle check-in, nearest-slot assignment, digital QR ticketing, and checkout billing.
   - **Driver**: Finds available spaces, pre-books dedicated time slots with conflict prevention, and tracks active stays.

2. **Interactive 3-Floor Live Parking Map**:
   - 60 slots across 3 levels (Level 1 Ground, Level 2 Mid-Deck, Level 3 Rooftop).
   - Status color-coding: Green (Free), Red (Occupied), Yellow (Reserved), Blue (EV Charging), Gray (Out of Service).
   - Hover tooltips showing slot specs, vehicle plate, entry time, and distance to gate.
   - Click to inspect slot: park vehicle, mark out of service, or initiate checkout.
   - **Car Drive Animation**: Animated vehicle sliding along the central driving lane into the allocated slot upon check-in and out through the exit gate upon payment.

3. **Digital Ticket with HTML5 Canvas QR Code**:
   - Generates unique ticket ID (`TCK-F1-S04-XXXX`).
   - Renders custom 2D QR matrix with corner finder patterns seeded deterministically by ticket ID.
   - Printable ticket view.

4. **Rule-Chaining Billing Engine**:
   - Rates by vehicle type: Bike ($1.50/h), Car ($3.00/h), SUV ($4.50/h), EV with charging ($4.00/h).
   - 10-minute free grace period.
   - 24-hour daily maximum caps (e.g., $25/day for cars).
   - Night discount: 20% off for hours between 10:00 PM and 06:00 AM.
   - Overstay penalty: +$10 flat penalty for vehicles parked over 12 hours.
   - Lost-ticket flat fine: $30.00.
   - Itemized printable receipts with payment methods (Credit Card, Mobile Wallet, Cash).

5. **Dynamic Surge Pricing**:
   - Facility occupancy $\ge 80\%$: Automatically activates **Surge (+20%)**.
   - Facility occupancy $\le 30\%$: Automatically activates **Off-Peak (-10%)**.
   - Header badge indicates active surge state in real time.

6. **Reservation System with No-Show Auto-Release**:
   - Pre-book slots with start and end times.
   - Prevents booking collisions with active parking sessions and other reservations.
   - 15-minute grace window: bookings are automatically released to the public if the driver is a no-show.

7. **Live Traffic Simulation Mode**:
   - Toggle switch in top bar spawns realistic vehicle arrivals and departures every 3–5 seconds.
   - Map slots, KPIs with count-up, notifications, and canvas charts update continuously.

8. **Pure Canvas Visualizations (Zero Libraries)**:
   - **Hourly Occupancy Line Chart**: 24-hour curve with gradient fill and surge baseline.
   - **Revenue Per Day Bar Chart**: Last 7 days with rounded caps and currency metrics.
   - **Vehicle Type Donut Chart**: Proportional ring for Car, SUV, EV, and Bike.
   - **Peak-Hour Heatmap**: 7 Days $\times$ 15 Operating Hours (08:00–22:00) colored by density.

9. **Data Management & Export**:
   - Search, multi-filter, and column sorting on active and completed records.
   - One-click instant CSV export.
   - "Reset Demo Data" restores pristine 60 slots and 7-day analytics.

---

## 🧮 Algorithms & Time Complexities

| Algorithm | Implementation File | Time Complexity | Purpose |
| :--- | :--- | :--- | :--- |
| **Nearest-Slot Allocation** | `parking.js` (`MinHeap`) | **$O(N \log N)$** build / **$O(\log N)$** extract | Priority queue allocating slot with minimum Euclidean/Manhattan distance from entrance gate. |
| **Interval Overlap Collision** | `parking.js` | **$O(R)$** | $\max(A_{\text{start}}, B_{\text{start}}) < \min(A_{\text{end}}, B_{\text{end}})$ prevents duplicate slot bookings. |
| **Rule-Chaining Fee Engine** | `billing.js` | **$O(1)$** amortized | Evaluates grace period, hourly rates, daily cap clamp, night discount, dynamic surge, and fines. |
| **Peak-Hour Forecasting** | `prediction.js` | **$O(H)$** ($H \le 168$) | Weighted Moving Average with decay weights $[0.45, 0.30, 0.15, 0.10]$ over historical diurnal patterns. |
| **Plate & Ticket Search** | `storage.js` | **$O(1)$** | JavaScript `Map` hash lookup by license plate or ticket ID. |

---

## 💾 Data Model (`localStorage` Schema)

| Key | Type | Description & Shape |
| :--- | :--- | :--- |
| `parksense_slots` | `Array<Slot>` | `[{ id: 'F1-S01', floor: 1, number: 1, row: 1, col: 1, distance: 2.0, type: 'car', isAccessible: true, isEv: false, status: 'free'\|'occupied'\|'reserved'\|'ev_charging'\|'out_of_service', currentVehicle: null\|{ plate, type, ticketId, entryTime }, updatedAt }]` |
| `parksense_tickets` | `Array<Ticket>` | Active inside vehicles: `[{ ticketId, slotId, floor, plate, type, entryTime, status: 'active', isOverstay: boolean }]` |
| `parksense_reservations`| `Array<Reservation>` | `[{ id: 'RES-01', slotId, plate, type, driverName, startTime, endTime, status: 'confirmed'\|'checked_in'\|'cancelled'\|'no_show_released', createdAt }]` |
| `parksense_history` | `Array<Receipt>` | Completed checkouts: `[{ id: 'RCP-123', ticketId, slotId, floor, plate, type, entryTime, exitTime, durationHours, fee, feeBreakdown: Object, paymentMethod, status: 'completed', paidAt }]` |
| `parksense_settings` | `Object` | `{ rates: { bike, car, suv, ev }, dailyCaps: { bike, car, suv, ev }, gracePeriodMinutes: 10, nightDiscountPercent: 20, overstayPenaltyFlat: 10, overstayThresholdHours: 12, lostTicketFine: 30, surgeThresholdHigh: 80, surgeThresholdLow: 30, surgeMultiplierHigh: 1.2, surgeMultiplierLow: 0.9 }` |
| `parksense_analytics_history` | `Array<Record>` | Past 7 days $\times$ 24 hours: `[{ dayOffset, dayOfWeek, dateStr, hour, occupiedSlots, totalSlots: 60, occupancyRate, revenue }]` |
| `parksense_current_role` | `string` | `'admin'` \| `'attendant'` \| `'driver'` |
| `parksense_theme` | `string` | `'dark'` \| `'light'` |

---

## 💻 How to Run

1. Clone or download the repository.
2. The project uses standard ES Modules and runs on any static web server:
   ```bash
   # Using Vite dev server (included in package.json):
   npm run dev

   # Or using Python 3 built-in HTTP server:
   python3 -m http.server 3000

   # Or using Node http-server / npx serve:
   npx serve -l 3000
   ```
3. Open your browser and navigate to `http://localhost:3000`.
4. Switch user roles in the top bar (`Admin`, `Attendant`, `Driver`) to test different views and workflows.
5. Turn on **"Live Traffic Demo"** in the top bar to watch real-time simulated parking traffic, car driving lane animations, and dynamic revenue updates.
