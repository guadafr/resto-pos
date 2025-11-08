RestoPOS LAN Server (sin dependencias)

1) Requisito: Node.js instalado (https://nodejs.org) — verificá con: node -v
2) Doble clic en iniciar_servidor.bat
3) Desde tablets/PC en la misma Wi‑Fi:
   http://IP-DE-TU-PC:3000/
   http://IP-DE-TU-PC:3000/admin.html (sirve estáticos desde C:\wamp64\www\RestoPOS_v3)

Para cambiar la carpeta de estáticos, editá server.js (const STATIC_DIR).

API disponible:
- GET/PUT /api/config
- GET/POST/DELETE /api/products
- GET/POST/DELETE /api/mozos
- GET/POST /api/orders  (+ charge/cancel)
- /api/cash/* (open, movement, close, history)
- /api/events (SSE)
