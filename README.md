# Garden Café · Pedidos por QR con Mercado Pago

Sistema completo para que tus clientes **escaneen el QR, vean la carta, pidan con el bot y paguen con Mercado Pago**. Cuando el pago queda verificado, el pedido llega solo a la cocina: **panel en pantalla + comanda impresa + WhatsApp**. Funciona para **mesa** y **take away**.

## Cómo funciona

```
Cliente escanea QR (Mesa 5 / Take away)
   → Carta web con promos y precios
   → Garden Bot: confirma pedido, mesa o take away, nombre, teléfono, horario, aclaraciones
   → Botón "Pagar con Mercado Pago" (tarjeta, débito, dinero en cuenta)
   → Mercado Pago avisa al sistema (webhook firmado)
   → El sistema CONSULTA a Mercado Pago que el pago esté aprobado y que el monto coincida
   → Recién ahí: número de pedido #001 → Panel de cocina (con sonido) + comanda impresa + WhatsApp
   → El cliente ve en su celu: Pagado → Preparando → ¡Listo!
```

Seguridad incluida: los precios siempre se calculan en el servidor (nadie puede cambiarlos desde el celu), se verifica la firma de Mercado Pago, un pago nunca se procesa dos veces, y si el monto no coincide el pedido queda marcado "⚠️ a revisar" en vez de ir a cocina.

## Páginas

| Dirección | Para quién | Qué hace |
|---|---|---|
| `/?mesa=5` | Cliente | Carta + bot (el QR de cada mesa ya trae el número) |
| `/?modo=takeaway` | Cliente | Carta + bot para llevar |
| `/estado?pedido=…` | Cliente | Seguimiento del pedido en vivo |
| `/panel` | Cocina / mostrador | Pedidos pagados en tiempo real, con contraseña |
| `/qr` | Vos | Genera e imprime los QR de todas las mesas y el de take away |

## Editar la carta

Todo está en **`menu.json`**: nombre, descripción, precio, `precio_anterior` (para mostrar el tachado en promos), `etiqueta` (ej. "Hasta las 12 hs") y `disponible` (`false` = aparece "Sin stock"). Guardás y listo, no hace falta reiniciar.

## Puesta en marcha (unos 20 minutos)

### 1. Credenciales de Mercado Pago
1. Entrá a **mercadopago.com.ar/developers** con tu cuenta vendedora → **Tus integraciones** → **Crear aplicación** (tipo: Pagos online · Checkout Pro).
2. En la aplicación → **Credenciales de producción** → copiá el **Access Token** (empieza con `APP_USR-`). No lo compartas con nadie.

### 2. Publicar el sistema (Render)
1. Subí esta carpeta a un repositorio de GitHub (privado).
2. En **render.com** → New → **Blueprint** → elegí el repositorio (usa `render.yaml`, plan Starter con disco para guardar pedidos).
3. Completá las variables:
   - `BASE_URL` → la dirección que te da Render, ej. `https://garden-cafe.onrender.com` (o tu dominio propio)
   - `MP_ACCESS_TOKEN` → el token del paso 1
   - `PANEL_PASSWORD` → una contraseña para la cocina
   - `CANT_MESAS` → cuántas mesas tenés

> También funciona en Railway, un VPS o una PC del local con Node.js 18+: `node server.js` (no necesita instalar nada más). Copiá `.env.example` como `.env` y completalo.

### 3. Activar las notificaciones de pago (webhook)
1. En tu aplicación de Mercado Pago → **Webhooks** → **Configurar notificaciones**.
2. URL de producción: `https://TU-DIRECCION/api/webhooks/mercadopago` · Evento: **Pagos** → Guardar.
3. Copiá la **clave secreta** que aparece y pegala en la variable `MP_WEBHOOK_SECRET`.

### 4. WhatsApp del local (opcional, gratis con CallMeBot)
1. Desde el WhatsApp que va a recibir los pedidos, seguí las instrucciones de **callmebot.com** (sección WhatsApp) para obtener tu `apikey`.
2. Variables: `WHATSAPP_MODO=callmebot`, `CALLMEBOT_TELEFONO=+549...`, `CALLMEBOT_APIKEY=...`
   (Para mucho volumen podés usar la API oficial de Meta: `WHATSAPP_MODO=cloud` + `WA_TOKEN`, `WA_PHONE_ID`, `WA_DESTINO`.)

### 5. Cocina e impresora de comandas
1. En la PC o tablet del mostrador abrí `https://TU-DIRECCION/panel` e ingresá la contraseña.
2. Tildá **"Imprimir comanda automáticamente"**. Dejá la impresora térmica (80 mm) como predeterminada.
3. Para que imprima **sin preguntar**, abrí Chrome con un acceso directo así:
   `chrome.exe --kiosk-printing https://TU-DIRECCION/panel`
4. Tocá "🔔 Probar sonido" una vez para habilitar el aviso sonoro.

### 6. Imprimir los QR
Desde el panel → **🔳 QR de mesas** → Imprimir. Uno por mesa + uno de take away para vidriera, mostrador o Instagram.

## Probar antes de cobrar de verdad
Dejá `MP_ACCESS_TOKEN` vacío (o `MP_MOCK=1`): el sistema funciona completo pero en lugar de Mercado Pago muestra una pantalla de "pago de prueba" con botones aprobar/rechazar. Hacé un pedido de punta a punta, mirá el panel, la comanda y el WhatsApp. Cuando todo esté bien, cargá el token real.

## Preguntas frecuentes
- **¿Y si el cliente paga pero cierra el celular?** No importa: Mercado Pago avisa al servidor igual y el pedido entra a cocina.
- **¿Y si el pago queda "en proceso"?** El pedido espera; entra a cocina automáticamente cuando Mercado Pago lo apruebe.
- **¿Dónde veo la plata?** En tu cuenta de Mercado Pago, como cualquier cobro. El panel muestra además el total cobrado del día.
- **Un pedido figura "⚠️ monto a revisar".** El pago recibido no coincide con el total. Revisá el número de pago en Mercado Pago y, si está bien, tocá "Lo verifiqué, preparar".
