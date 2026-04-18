# Risco_Stack_RPi_V2

Gateway Web + Modbus TCP/IP + BACnet/IP para paneles de intrusion RISCO, orientado a Raspberry Pi 5.

Proyecto independiente para Raspberry Pi 5. Su objetivo es operar como gateway estable entre paneles RISCO, la interfaz web y clientes Modbus TCP.

Mantiene la logica y el objetivo operativo del gateway:
- comunicacion LAN con el panel RISCO
- dashboard web
- menu de configuracion
- servidor Modbus TCP
- servidor BACnet/IP opcional para BMS
- login web y gestion de usuarios
- soporte validado para particiones de dos digitos
- paginas de diagnostico, mapa Modbus, mapa BACnet y debug

No usa Docker. El flujo recomendado es desarrollar en Windows con VS Code y desplegar/actualizar en Raspberry Pi mediante GitHub.

## Arquitectura del repo

```text
Risco_Stack_RPi_V2/
|- bridge/            # Nucleo de comunicacion con el panel RISCO
|- gateway/           # Web UI, auth, config y servidor Modbus TCP
|- runtime/           # Configuracion default y datos persistentes
|- scripts/           # Scripts de soporte para Raspberry Pi
|- deploy/systemd/    # Servicio systemd de ejemplo
|- README.md
`- LICENSE
```

### `bridge/`
Modulo de bajo nivel del panel:
- sockets y sesion con el panel
- descubrimiento de zonas, salidas y particiones
- parser de estados
- armado, desarmado y bypass
- estrategias para particiones 10+

### `gateway/`
Aplicacion principal:
- servidor web
- login
- pagina de configuracion
- dashboard en tiempo real
- servidor Modbus TCP
- servidor BACnet/IP opcional
- paginas de diagnostico, Modbus, BACnet y debug
- bootstrap del runtime

### `runtime/`
Runtime persistente:
- `runtime/config.default.json`: plantilla versionada
- `runtime/data/config.json`: config activa
- `runtime/data/users.json`: usuarios del login

### `scripts/`
- `scripts/build-rpi.sh`: instala dependencias y compila todo
- `scripts/set-ip-rpi.sh`: cambio de IP del Raspberry desde la web

### `deploy/systemd/`
- `deploy/systemd/risco-gateway.service`: servicio para arranque automatico

## Flujo recomendado de trabajo

La idea operativa desde ahora es esta:

1. Desarrollas y haces cambios en Windows con VS Code.
2. Haces commit y push al repo GitHub `Risco_Stack_RPi_V2`.
3. En la Raspberry Pi 5 haces `git pull`.
4. Recompilas.
5. Reinicias el servicio.

Asi no vuelves a copiar el proyecto manualmente desde cero.

## Desarrollo en Windows

### Ruta local de trabajo

En este PC la ruta es:

```powershell
C:\manting_rpi\risco_stack_RPi_V2
```

### Flujo de commit y push desde VS Code

1. Abre en VS Code la carpeta:

```powershell
C:\manting_rpi\risco_stack_RPi_V2
```

2. Haz los cambios.
3. En Source Control revisa los archivos modificados.
4. Escribe el mensaje de commit.
5. Haz `Commit`.
6. Haz `Push` al repositorio GitHub del proyecto.

Si prefieres terminal en Windows:

```powershell
cd C:\manting_rpi\risco_stack_RPi_V2
git add -A
git commit -m "Release V2.0: simplify architecture for Raspberry Pi"
git push -u origin main
```

## Despliegue inicial en Raspberry Pi 5

### 1. Clonar el repo

```bash
cd /home/pi
git clone https://github.com/jatsoca/Risco_Stack_RPi_V2.git
cd /home/pi/Risco_Stack_RPi_V2
```

### 2. Instalar Node.js y npm

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm
node -v
npm -v
```

Node.js 20 recomendado.

### 3. Compilar el proyecto

```bash
cd /home/pi/Risco_Stack_RPi_V2
chmod +x ./scripts/build-rpi.sh
./scripts/build-rpi.sh
```

Ese script hace:
1. `npm install` en `bridge`
2. `npm run build` en `bridge`
3. `npm install` en `gateway`
4. `npm run build` en `gateway`

### 4. Primer arranque manual

```bash
cd /home/pi/Risco_Stack_RPi_V2/gateway
sudo node dist/main.js
```

En el primer arranque:
- si `runtime/data/config.json` no existe, se crea desde `runtime/config.default.json`
- si `runtime/data/users.json` no existe, se crea automaticamente

### Credenciales iniciales

- usuario: `admin`
- contrasena: `Admin123`

### Endpoints principales

- web: `http://IP_DEL_RPI:1001`
- config: `http://IP_DEL_RPI:1001/config`
- diagnostico: `http://IP_DEL_RPI:1001/diagnostics`
- mapa Modbus: `http://IP_DEL_RPI:1001/modbus`
- BACnet/IP: `http://IP_DEL_RPI:1001/bacnet`
- debug: `http://IP_DEL_RPI:1001/debug`
- health: `http://IP_DEL_RPI:1001/health`
- Modbus TCP: puerto `502`
- BACnet/IP: puerto UDP `47808` cuando esta habilitado

## Actualizacion en Raspberry Pi 5 desde GitHub

Cada vez que hagas cambios en Windows y los subas a GitHub:

```bash
cd /home/pi/Risco_Stack_RPi_V2
git pull
./scripts/build-rpi.sh
sudo systemctl restart risco-gateway.service
```

Si aun no tienes el servicio instalado, puedes arrancar manualmente:

```bash
cd /home/pi/Risco_Stack_RPi_V2/gateway
sudo node dist/main.js
```

Este es el flujo recomendado a partir de ahora:
- Windows: editas, commit, push
- Raspberry: pull, build, restart

## Servicio systemd en Raspberry Pi 5

### Instalar el servicio

```bash
sudo cp /home/pi/Risco_Stack_RPi_V2/deploy/systemd/risco-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now risco-gateway.service
```

### Ver estado y logs

```bash
sudo systemctl status risco-gateway.service
sudo journalctl -u risco-gateway.service -f
```

### Si no quieres usar root

El puerto `502` requiere privilegios por ser menor a `1024`.

Alternativa:

```bash
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/node
```

Luego ajustas el servicio para correr como `pi`.

## Configuracion del gateway

### Rutas de runtime por defecto

- config base: `runtime/config.default.json`
- config activa: `runtime/data/config.json`
- usuarios: `runtime/data/users.json`
- assets web: `gateway/public`
- script cambio IP: `scripts/set-ip-rpi.sh`

### Variables de entorno soportadas

- `RISCO_CONFIG_FILE`
- `RISCO_DEFAULT_CONFIG_FILE`
- `RISCO_DATA_DIR`
- `RISCO_PUBLIC_DIR`
- `RISCO_HOST_IP_SCRIPT`

Compatibilidad heredada:
- `RISCO_MQTT_HA_CONFIG_FILE`
- `RISCO_MQTT_HA_DEFAULT_CONFIG`

### Parametros principales

- `panel.panelIp`
- `panel.panelPort`
- `panel.panelPassword`
- `panel.panelId`
- `panel.socketMode`
- `panel.watchDogInterval`
- `panel.commandsLog`
- `web.http_port`
- `modbus.port`
- `modbus.host`
- `bacnet.enable`
- `bacnet.port`
- `bacnet.interface`
- `bacnet.broadcastAddress`
- `bacnet.deviceId`
- `bacnet.allowWrite`

## Mapas BMS

Modbus TCP:

- Holding registers `1-32`: particiones. Valores: `0=desarmada`, `1=armada`, `2=alarmada`, `3=ready`, `4=not ready`.
- Holding registers `33-544`: zonas. Valores: `0=cerrada`, `1=abierta`, `2=bypass`.
- Discrete inputs `1-32`: alarma de particion.
- Discrete inputs `33-544`: zona abierta.

BACnet/IP:

- Device instance configurable, default `432001`.
- Analog Value `1-32`: mismo valor de particiones que Modbus.
- Analog Value `33-544`: mismo valor de zonas que Modbus.
- Binary Value `1-32`: alarma de particion.
- Binary Value `33-544`: zona abierta.
- Escritura BACnet queda bloqueada por defecto. Al habilitarla, AV `1-32` acepta `0=desarmar` y `1=armar total`; AV `33-544` acepta `0=normal` y `2=bypass`.

## Particiones de dos digitos

La estrategia final de produccion para LightSYS Plus RP432MP es `p_suffix_equals_plain`.
Esta estrategia fue validada en panel real el 2026-04-17 con las particiones 12 y 14.

Tramas enviadas:
- Armar total: `ARMP=N`
- Desarmar: `DISARMP=N`
- Armar parcial: `STAY=N`

Configuracion recomendada:

```json
"partitionCommandMode": "fixed",
"partitionCommandStrategy": "p_suffix_equals_plain",
"partitionCommandProbeOrder": ["p_suffix_equals_plain"]
```

El gateway deja en log la trama exacta enviada al panel y la respuesta del panel cuando `panel.commandsLog` esta habilitado.

## Cambio de IP del Raspberry desde la web

La web usa:

```text
scripts/set-ip-rpi.sh
```

Si quieres usarlo como script del sistema:

```bash
sudo install -m 0755 /home/pi/Risco_Stack_RPi_V2/scripts/set-ip-rpi.sh /usr/local/bin/set-ip-rpi.sh
```

Si el servicio no corre como `root`, debes autorizarlo con `sudoers`.

## Validacion hecha en esta reorganizacion

Validado en esta sesion:
- instalacion limpia de dependencias en `bridge`
- instalacion limpia de dependencias en `gateway`
- compilacion de `bridge`
- compilacion de `gateway`
- arranque de prueba del gateway
- respuesta correcta de `/health`
- protocolo de armado/desarmado de particiones `10+` validado contra panel LightSYS Plus real desde la version Windows del mismo core
- eliminacion de consulta duplicada `ZTYPE*ID?` en discovery de zonas
- modulo BACnet/IP probado localmente con lectura y escritura controlada en puerto UDP alterno
- compilacion de las nuevas paginas web de diagnostico, Modbus y BACnet

Pendiente en sitio:
- despliegue de esta version RPi V2 sobre el Raspberry Pi 5 de produccion
- validacion final del servicio `risco-gateway.service` en el Raspberry conectado al panel
- escritura real Modbus/BACnet con cliente BMS externo
- ejecucion real de `systemd` en Raspberry Pi

## Resumen operativo

Desde ahora el flujo recomendado es:

### En Windows

```powershell
cd C:\manting_rpi\risco_stack_RPi_V2
git add -A
git commit -m "tu cambio"
git push
```

### En Raspberry Pi 5

```bash
cd /home/pi/Risco_Stack_RPi_V2
git pull
./scripts/build-rpi.sh
sudo systemctl restart risco-gateway.service
```

Ese es el camino correcto para evolucionar el proyecto sin volver a copiar todo manualmente.
