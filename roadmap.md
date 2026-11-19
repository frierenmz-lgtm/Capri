# Capri roadmap

## Estado actual

- [x] Editar mensajes enviados y regenerar la última respuesta de Capri
- [x] Dictar mensajes con el micrófono y leer respuestas en voz alta
- [x] Compartir conversaciones mediante enlaces públicos de solo lectura
- [x] Adjuntar y analizar imágenes
- [x] Leer documentos adjuntos (PDF, TXT, CSV y archivos de texto/código compatibles)
- [x] Buscar información web durante las respuestas mediante la herramienta de búsqueda
- [x] Exponer herramientas MCP de solo lectura para listar, buscar y leer conversaciones
- [x] Guardar conversaciones, mensajes e instrucciones personalizadas en Supabase

## Trabajo pendiente

### Fase 1: estabilización web
- [ ] Instalar dependencias de forma reproducible y confirmar la compilación de producción
- [ ] Ejecutar y corregir la suite de pruebas y ESLint
- [ ] Revisar límites de solicitudes, validación de entradas y autorización en rutas del servidor
- [ ] Verificar configuración y políticas RLS de Supabase en el proyecto conectado

### Fase 2: motor de IA en la nube
- [ ] Verificar streaming, cancelación, errores del proveedor y límites de uso
- [ ] Añadir controles de configuración de modelo cuando el proveedor los permita

### Fase 3: memoria
- [ ] Diseñar memoria de usuario independiente del historial de chat
- [ ] Añadir extracción, edición, eliminación y recuperación de recuerdos con autorización del usuario

### Fase 4: capacidades y experiencia
- [ ] Probar voz, imágenes y documentos con archivos reales y límites de tamaño
- [ ] Probar herramientas MCP y el flujo OAuth de extremo a extremo
- [ ] Mejorar accesibilidad, estados de carga y manejo de errores

### Fase 5: publicación
- [ ] Ejecutar pruebas de regresión en entorno de producción
- [ ] Verificar secretos, variables de entorno, políticas de almacenamiento y registros
- [ ] Documentar despliegue, recuperación y mantenimiento

> Alcance del proyecto: aplicación web conectada a servicios de IA en la nube. El desarrollo Android, los modelos locales y el modo sin conexión quedan fuera del alcance.


## Seguridad web (revisión 2026-11-08)

- [x] Reforzar RLS para impedir que un usuario reasigne mensajes a conversaciones ajenas.
- [x] Restringir roles y estructura JSON de mensajes en la base de datos.
- [x] Aplicar límites de lectura del cuerpo HTTP en voz y transcripción, incluso cuando la petición llega por streaming sin `Content-Length`.
- [x] Ignorar archivos `.env` en Git para reducir el riesgo de publicar credenciales.
- [ ] Aplicar la migración `0006_rls_message_ownership` en el proyecto Supabase antes de desplegar estos cambios.
- [ ] Configurar límites de almacenamiento y cuotas de uso en Supabase/Lovable Cloud.
- [ ] Implementar rate limiting por usuario para chat, voz y transcripción.
- [ ] Ejecutar pruebas de integración con dos usuarios distintos y verificar que no pueden leer ni modificar los datos del otro.


## Revisión del motor de IA en la nube (8 de noviembre de 2026)

- El chat utiliza Lovable AI Gateway mediante el SDK de AI.
- Las respuestas se transmiten como UI message stream y los errores se traducen a mensajes legibles.
- Se desactivó el envío de resúmenes de razonamiento al navegador: la interfaz no los muestra y no deben guardarse como partes de los mensajes.
- Se retiró la solicitud de contenido de razonamiento cifrado, que no era necesario para la interfaz.
- Se limitó la generación automática de títulos a 32 tokens para evitar respuestas innecesariamente largas.
- Pendiente: probar streaming, cancelación, respuestas 402/429 y fallos del proveedor con credenciales reales de Lovable Cloud.


## Memoria persistente controlada por el usuario (8 de noviembre de 2026)

- Añadida la tabla `capri_memories` con políticas RLS por propietario.
- Se pueden añadir, editar y eliminar recuerdos desde Ajustes, con categorías y un límite de 500 caracteres por entrada.
- La extracción automática está activada por defecto y se puede desactivar desde Ajustes.
- El servidor recupera recuerdos de la cuenta autenticada y selecciona hasta diez por coincidencia léxica con el último mensaje; si no hay coincidencias, usa hasta cinco recuerdos recientes.
- La memoria se añade como contexto, no como instrucciones; el mensaje actual del usuario tiene prioridad.
- Pendiente: aplicar la migración en Supabase y verificar consultas CRUD y recuperación con dos cuentas distintas.


## Memoria automática (2026-11-08)
- Extracción automática de hasta tres recuerdos por turno a partir de afirmaciones explícitas del usuario.
- Exclusión explícita de datos sensibles, secretos, hipótesis y datos de terceros.
- Categoría, importancia, origen y caducidad opcional para cada recuerdo.
- Consolidación aproximada por coincidencia léxica dentro de la misma categoría y límite de 120 recuerdos, preservando primero los manuales.
- La recuperación sigue siendo léxica; embeddings y búsqueda semántica quedan pendientes.
- Requiere aplicar las migraciones 0007, 0008 y 0009 en Supabase antes de probar.
