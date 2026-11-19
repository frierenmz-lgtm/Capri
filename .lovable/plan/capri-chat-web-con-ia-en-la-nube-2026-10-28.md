# Capri: chat web con IA en la nube

Recrear el chat "Capri" de tu script como app web, con varias conversaciones guardadas en la nube por cuenta. En vez del modelo local, Capri responde con IA en la nube.

## Lo que verás
- **Página de inicio** (`/`): presentación de Capri y botón "Entrar".
- **Inicio de sesión** (`/auth`): correo y contraseña.
- **Chat** (`/chat/:id`): lista de conversaciones a la izquierda (menú en móvil), botón "Nueva conversación", borrar conversación, y el chat con respuestas que aparecen mientras se escriben.
- Capri mantiene su personalidad: "asistente breve y útil, responde en español".
- Estilo oscuro, como tu script, pero más pulido y adaptado a celular.

## Detalles técnicos
- Activar Lovable Cloud: auth email/contraseña, tablas `threads` y `messages` (por usuario, con RLS y GRANTs).
- Ruta protegida `_authenticated/chat.$threadId.tsx`; título de conversación tomado del primer mensaje.
- Servidor: ruta de streaming con AI SDK vía Lovable AI Gateway (modelo por defecto), verifica que la conversación pertenece al usuario y guarda mensajes en `onFinish`.
- UI con componentes AI Elements; `head()` propio en cada página.
