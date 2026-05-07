# Gomoku — Decentralized P2P Board Game

A professional, high-performance Gomoku (五子棋) game built with **React**, **Nostr**, and **WebRTC**. Experience zero-latency gameplay directly in your browser with no central server required.

![Gomoku Preview](https://raw.githubusercontent.com/gomoku/gomoku/main/preview.png) *(Note: Replace with actual screenshot later)*

## 🌟 Key Features

-   **Zero-Server Architecture**: Uses the [Nostr](https://github.com/nostr-protocol/nostr) protocol for decentralized signaling and peer discovery.
-   **True P2P Gameplay**: Direct browser-to-browser connection via WebRTC DataChannels for the lowest possible latency.
-   **Professional Game Interface**: 
    -   **Three-Column Layout**: Game information, high-fidelity board, and real-time chat.
    -   **Premium Aesthetics**: Dark mode design with glassmorphism panels, golden accents, and smooth animations.
    -   **SVG-Based Board**: High-precision rendering with coordinate labels, star points, and 3D glossy pieces.
-   **Advanced Game Rules**:
    -   **Standard (无禁手)**: Classic 5-in-a-row.
    -   **Renju (有禁手)**: Implements forbidden move rules for Black (Overline, Double-Four, Double-Three).
-   **Robust Communication**: 
    -   Integrated real-time chat with system event logging.
    -   Automatic reconnection and signaling retry logic.
    -   Cryptographically signed moves and messages using Nostr identity.

## 🛠️ Tech Stack

-   **Frontend**: React 19, TypeScript, Vite
-   **Networking**: `simple-peer` (WebRTC), `nostr-tools` (Signaling)
-   **Styling**: Vanilla CSS (Custom Design System)
-   **Security**: Nostr (NIP-01) for identity and signing

## 🚀 Getting Started

### Prerequisites

-   Node.js (v20 or higher)
-   npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/gomoku.git
    cd gomoku
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Development

Start the local development server:
```bash
npm run dev
```

### Production Build

Build the optimized production bundle:
```bash
npm run build
```

## 🎮 How to Play

1.  **Host a Game**:
    -   Choose your rules (Standard or Renju).
    -   Click **Host Game**.
    -   Copy the unique invite link generated in the sidebar.
2.  **Join a Game**:
    -   Open the invite link in another browser or share it with a friend.
    -   The game will automatically connect via Nostr relays.
3.  **Play**:
    -   Take turns placing pieces on the intersections.
    -   The first to reach 5 in a row (subject to rules) wins.

## 📡 Default Relays

The game currently uses the following Nostr relays for signaling:
- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`
- `wss://offchain.pub`
- `wss://relay.snort.social`

## 📜 License

This project is licensed under the **GPL-3.0 License**. See the [LICENSE](LICENSE) file for details.

---

Built with ❤️ for the decentralized web.
