# JATAYU pitch

About 90 seconds.

**Problem.** After a collapse or in a hazardous space, responders often cannot see inside or safely send someone in. Cameras need line of sight, and wearables only help if someone is already wearing one.

**Idea.** Wi-Fi signals change as things move. JATAYU uses low-cost hardware to read those changes, and organises them for a human to review. It adds a gas sensor reading and keeps an auditable record of every observation and decision.

**How it works.** An ESP32-S3 captures Wi-Fi channel-state data. A Raspberry Pi 4B processes it locally, stores derived results in SQLite and serves an operator console. No cloud is needed, and raw signal data is not stored long term.

**Why it's different.** It is cheap, needs no camera or wearable, and runs offline. And it keeps a person in the loop: it reports observations for review and never declares that someone was found.

**Where we are.**

- Working on real hardware: live capture, the Pi pipeline, the operator console and the incident workflow, at about 0.1% packet loss.
- Tested in simulation: the full workflow, including the demo mode we'll show you.
- Not yet proven: breathing detection on real signals. Our first trial, in a busy room, found no clear rhythm, and that is the next thing we're testing.
- Not built yet: the Arduino firmware for the gas sensor and keypad, and multi-node sensing.

**Ask.** Time and a quiet test space to run controlled trials, then feedback from people who work in search and rescue.

**Close.** "JATAYU is named for the bird who raised the alarm. We're building the part that raises the question, so a person can decide what to do next."
