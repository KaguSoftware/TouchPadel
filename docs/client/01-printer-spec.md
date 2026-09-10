# Receipt Printer Specification / مواصفات طابعة الفواتير

Buy any printer that meets ALL of the following. Two example models that do are listed below —
either is fine, as is any equivalent.

اشتروا أي طابعة تحقق جميع المواصفات التالية. النموذجان أدناه مثالان مناسبان.

## Required specification

| Requirement / المتطلب | Value |
|---|---|
| Paper / الورق | 80mm thermal roll (حراري 80 ملم) |
| Resolution / الدقة | 203 dpi |
| Protocol / البروتوكول | **ESC/POS**, with **`GS v 0` raster graphics** support (needed for Arabic text — we print Arabic as rendered images, so raster support is not optional) |
| Connections / التوصيل | **USB + Ethernet** (both ports on the same unit) |
| Cutter / القاطع | Auto-cutter |

Example models (this class, not a mandate): **Epson TM-T20III (Ethernet variant)**,
**Xprinter XP-80C**. If buying locally, show the seller this table.

Do **not** buy: 58mm printers, Bluetooth-only printers, or label printers.

لا تشتروا: طابعات 58 ملم، أو طابعات بلوتوث فقط، أو طابعات الملصقات.

## Power — UPS (required, per the contract)

The Scope of Work makes this Touch's responsibility: a **UPS (uninterruptible power supply)**
covering, at minimum:

- the till machine (جهاز الكاشير)
- this printer (الطابعة)
- the router (الراوتر)
- the network switch (السويتش)

Most interruptions in Iraq are power, not internet. The till is built to keep trading through
an outage — but only if it and its printer stay powered. A UPS costs little against the trading
it protects.

## Venue network / شبكة المحل

- The till machine must have a **fixed address on the local network**: either a **DHCP
  reservation** in the router (preferred — ask whoever manages the router) or a manually set
  **static IP**.
- Why: the kitchen screen and the printer talk to the till over the local network by address.
  If the till's address changes, kitchen tickets and printing stop until it is fixed.
- Wire the till and printer by **Ethernet cable**, not Wi-Fi, wherever possible.
- A **business internet connection wired to the till** is also Touch's responsibility per the
  contract.
