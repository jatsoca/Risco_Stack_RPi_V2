# Risco_Stack_RPi_V2

Gateway Web + Modbus TCP/IP para paneles de intrusion RISCO, orientado a Raspberry Pi 5.

Esta version 2 simplifica la estructura del repo sin cambiar la logica ni el objetivo del proyecto:
- comunicacion LAN con el panel RISCO
- dashboard web
- menu de configuracion
- servidor Modbus TCP
- login web y gestion de usuarios
- soporte experimental para particiones de dos digitos

No usa Docker. El objetivo es desarrollar desde Windows y desplegar/actualizar en Raspberry Pi mediante GitHub.

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
- `deploy/systemd/risco-stack-rpi-v2.service`: servicio para arranque automatico

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

### Remotos Git actuales

En esta copia local ya quedo asi:
- `origin` -> `https://github.com/jatsoca/Risco_Stack_RPi_V2.git`
- `old-origin` -> `https://github.com/jatsoca/risco_stack_RPi.git`

Verificar:

```powershell
git remote -v
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
6. Haz `Push` al repo nuevo.

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
- health: `http://IP_DEL_RPI:1001/health`
- Modbus TCP: puerto `502`

## Actualizacion en Raspberry Pi 5 desde GitHub

Cada vez que hagas cambios en Windows y los subas a GitHub:

```bash
cd /home/pi/Risco_Stack_RPi_V2
git pull
./scripts/build-rpi.sh
sudo systemctl restart risco-stack-rpi-v2.service
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
sudo cp /home/pi/Risco_Stack_RPi_V2/deploy/systemd/risco-stack-rpi-v2.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now risco-stack-rpi-v2.service
```

### Ver estado y logs

```bash
sudo systemctl status risco-stack-rpi-v2.service
sudo journalctl -u risco-stack-rpi-v2.service -f
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

## Particiones de dos digitos

Se mantiene el ajuste experimental para particiones `10+`.

Estrategias disponibles:
- `equals_star_decimal`
- `colon_decimal`
- `colon_zero_pad_3`
- `equals_zero_pad_3`
- `equals_hex`
- `equals_hex_zero_pad_2`
- `equals_plain`

Modo recomendado por ahora:

```json
"partitionCommandMode": "probe"
```

Orden default:

```json
[
  "equals_star_decimal",
  "colon_decimal",
  "colon_zero_pad_3",
  "equals_zero_pad_3",
  "equals_hex_zero_pad_2",
  "equals_plain"
]
```

El gateway deja en log la estrategia y la trama exacta enviada al panel para que puedas validar cual funciona mejor.

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

No validado aqui:
- conexion real a un panel fisico
- escritura real Modbus con cliente externo
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
sudo systemctl restart risco-stack-rpi-v2.service
```

Ese es el camino correcto para evolucionar el proyecto sin volver a copiar todo manualmente.
