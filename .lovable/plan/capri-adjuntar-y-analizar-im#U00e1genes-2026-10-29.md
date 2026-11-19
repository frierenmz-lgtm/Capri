# Capri: adjuntar y analizar imágenes

## Lo que verás
- Botón de clip en la caja de texto para elegir imágenes (JPG, PNG, WebP, GIF), y también pegar con Ctrl+V o arrastrar fotos.
- Miniaturas encima de la caja antes de enviar, con una "x" para quitarlas. Hasta 4 imágenes por mensaje, de 5 MB máximo cada una.
- Las imágenes aparecen en tu mensaje dentro del chat y siguen ahí al recargar o volver después.
- Capri las describe, lee texto de capturas y responde sobre ellas.
- Puedes enviar solo imágenes, sin texto.

## Detalles técnicos
- Almacenamiento: bucket privado `chat-images` con políticas por carpeta `{user_id}/...`; el cliente sube el archivo antes de enviar y guarda la ruta en la parte `file` del mensaje (`url` = ruta del bucket, `mediaType`).
- Servidor (`chat.server.ts`): antes de `convertToModelMessages`, verifica que cada ruta empiece con el `user_id` del usuario, descarga con el cliente del usuario y la convierte en data URL para el modelo (`openai/gpt-6-astra`, Responses, partes de imagen). En la BD se guarda la ruta, no el base64.
- Cliente: `PromptInput` con `accept="image/*"`, `multiple`, `maxFiles`, `maxFileSize`; render de partes `file` con URLs firmadas (`createSignedUrl`) cacheadas con React Query.
- Exportar a Markdown: las imágenes aparecen como "[imagen adjunta]".
- Título automático y búsqueda siguen usando solo el texto.
- Prueba de punta a punta con sesión iniciada: subir una imagen, recibir descripción, recargar y verla; limpiar la conversación de prueba.
