import type { RealtimeState } from '../web/server';

const Bacnet = require('node-bacnet');
const bacnetEnum = Bacnet.enum;

export interface BacnetOptions {
  enable: boolean;
  port: number;
  interface?: string;
  broadcastAddress?: string;
  deviceId: number;
  deviceName: string;
  vendorId: number;
  allowWrite?: boolean;
  apduTimeout?: number;
}

export interface BacnetStatsHooks {
  onWhoIs?: () => void;
  onRead?: () => void;
  onWrite?: () => void;
  onError?: (message: string) => void;
  onWriteValue?: (object: {
    kind: 'partition-state' | 'zone-state' | 'partition-alarm' | 'zone-open' | 'device';
    instance: number;
    value: number;
  }) => Promise<boolean>;
}

export interface BacnetRuntimeStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  interface: string;
  broadcastAddress: string;
  deviceId: number;
  deviceName: string;
  vendorId: number;
  allowWrite: boolean;
  lastError?: string;
}

type BacnetObjectRef = {
  type: number;
  instance: number;
  name: string;
  description: string;
  kind: 'device' | 'partition-state' | 'zone-state' | 'partition-alarm' | 'zone-open';
};

const PARTITION_REGS = 32;
const ZONE_REGS = 512;
const OBJECT_TYPE = bacnetEnum.ObjectType;
const PROPERTY = bacnetEnum.PropertyIdentifier;
const TAG = bacnetEnum.ApplicationTag;
const ASN1_ARRAY_ALL = bacnetEnum.ASN1_ARRAY_ALL;

const charValue = (value: string) => [{ type: TAG.CHARACTER_STRING, value }];
const enumValue = (value: number) => [{ type: TAG.ENUMERATED, value }];
const unsignedValue = (value: number) => [{ type: TAG.UNSIGNED_INTEGER, value }];
const realValue = (value: number) => [{ type: TAG.REAL, value }];
const boolValue = (value: boolean) => [{ type: TAG.BOOLEAN, value }];
const objectIdValue = (type: number, instance: number) => [{ type: TAG.OBJECTIDENTIFIER, value: { type, instance } }];
const bitStringValue = (bitsUsed: number, value = 0) => [{ type: TAG.BIT_STRING, value: { bitsUsed, value: [value] } }];

export function normalizeBacnetOptions(options?: Partial<BacnetOptions>): BacnetOptions {
  return {
    enable: !!options?.enable,
    port: Number(options?.port || 47808),
    interface: options?.interface || '0.0.0.0',
    broadcastAddress: options?.broadcastAddress || '255.255.255.255',
    deviceId: Number(options?.deviceId || 432001),
    deviceName: options?.deviceName || 'Risco Gateway BACnet',
    vendorId: Number(options?.vendorId || 999),
    allowWrite: !!options?.allowWrite,
    apduTimeout: Number(options?.apduTimeout || 3000),
  };
}

export function encodePartitionValue(status: string, ready?: boolean): number {
  if (status === 'triggered') return 2;
  if (ready === true) return 3;
  if (ready === false) return 4;
  if (status === 'armed_home' || status === 'armed_away') return 1;
  return 0;
}

export function encodeZoneValue(open: boolean, bypass: boolean): number {
  if (bypass) return 2;
  return open ? 1 : 0;
}

export function buildBacnetObjectMap(state?: RealtimeState, deviceId = 432001) {
  const objects: BacnetObjectRef[] = [{
    type: OBJECT_TYPE.DEVICE,
    instance: deviceId,
    name: 'Risco Gateway',
    description: 'Risco Gateway BACnet device',
    kind: 'device',
  }];

  for (let id = 1; id <= PARTITION_REGS; id++) {
    const p = state?.partitions.get(id);
    objects.push({
      type: OBJECT_TYPE.ANALOG_VALUE,
      instance: id,
      name: `PART_${String(id).padStart(3, '0')}_STATE`,
      description: `Particion ${id}: 0=disarmed, 1=armed, 2=triggered, 3=ready, 4=not ready${p ? ` (${p.status})` : ''}`,
      kind: 'partition-state',
    });
    objects.push({
      type: OBJECT_TYPE.BINARY_VALUE,
      instance: id,
      name: `PART_${String(id).padStart(3, '0')}_ALARM`,
      description: `Particion ${id} en alarma`,
      kind: 'partition-alarm',
    });
  }

  for (let id = 1; id <= ZONE_REGS; id++) {
    const instance = PARTITION_REGS + id;
    const z = state?.zones.get(id);
    objects.push({
      type: OBJECT_TYPE.ANALOG_VALUE,
      instance,
      name: `ZONE_${String(id).padStart(3, '0')}_STATE`,
      description: `Zona ${id}: 0=closed, 1=open, 2=bypass${z?.label ? ` - ${z.label}` : ''}`,
      kind: 'zone-state',
    });
    objects.push({
      type: OBJECT_TYPE.BINARY_VALUE,
      instance,
      name: `ZONE_${String(id).padStart(3, '0')}_OPEN`,
      description: `Zona ${id} abierta${z?.label ? ` - ${z.label}` : ''}`,
      kind: 'zone-open',
    });
  }

  return objects;
}

export function buildBacnetMapSummary(options: BacnetOptions, state?: RealtimeState) {
  return {
    device: {
      objectType: 'device',
      instance: options.deviceId,
      name: options.deviceName,
    },
    analogValues: {
      partitions: 'AV 1-32: 0=disarmed, 1=armed, 2=triggered, 3=ready, 4=not ready',
      zones: 'AV 33-544: 0=closed, 1=open, 2=bypass',
    },
    binaryValues: {
      partitions: 'BV 1-32: inactive=normal, active=alarm',
      zones: 'BV 33-544: inactive=closed, active=open',
    },
    currentCounts: {
      partitions: state?.partitions.size || 0,
      zones: state?.zones.size || 0,
    },
  };
}

export function startBacnetServer(
  optionsInput: Partial<BacnetOptions> | undefined,
  state: RealtimeState,
  hooks: BacnetStatsHooks = {},
) {
  const options = normalizeBacnetOptions(optionsInput);
  const status: BacnetRuntimeStatus = {
    enabled: options.enable,
    running: false,
    port: options.port,
    interface: options.interface || '0.0.0.0',
    broadcastAddress: options.broadcastAddress || '255.255.255.255',
    deviceId: options.deviceId,
    deviceName: options.deviceName,
    vendorId: options.vendorId,
    allowWrite: !!options.allowWrite,
  };

  if (!options.enable) {
    return {
      status: () => status,
      map: () => buildBacnetMapSummary(options, state),
      stop: () => undefined,
    };
  }

  let client: any;
  try {
    client = new Bacnet({
      port: options.port,
      interface: options.interface,
      broadcastAddress: options.broadcastAddress,
      apduTimeout: options.apduTimeout,
    });
  } catch (error) {
    status.lastError = (error as Error).message;
    hooks.onError?.(status.lastError);
    return {
      status: () => status,
      map: () => buildBacnetMapSummary(options, state),
      stop: () => undefined,
    };
  }

  const objectList = () => buildBacnetObjectMap(state, options.deviceId);
  const findObject = (objectId: { type: number; instance: number }) => (
    objectList().find((item) => item.type === objectId.type && item.instance === objectId.instance)
  );

  const objectPresentValue = (obj: BacnetObjectRef) => {
    if (obj.kind === 'partition-state') {
      const p = state.partitions.get(obj.instance);
      return realValue(encodePartitionValue(p?.status || 'disarmed', p?.ready));
    }
    if (obj.kind === 'zone-state') {
      const zoneId = obj.instance - PARTITION_REGS;
      const z = state.zones.get(zoneId);
      return realValue(encodeZoneValue(!!z?.open, !!z?.bypass));
    }
    if (obj.kind === 'partition-alarm') {
      const p = state.partitions.get(obj.instance);
      return enumValue(p?.status === 'triggered' ? bacnetEnum.BinaryPV.ACTIVE : bacnetEnum.BinaryPV.INACTIVE);
    }
    if (obj.kind === 'zone-open') {
      const zoneId = obj.instance - PARTITION_REGS;
      const z = state.zones.get(zoneId);
      return enumValue(z?.open ? bacnetEnum.BinaryPV.ACTIVE : bacnetEnum.BinaryPV.INACTIVE);
    }
    return realValue(0);
  };

  const propertyValues = (obj: BacnetObjectRef, property: { id: number; index?: number }) => {
    switch (property.id) {
      case PROPERTY.OBJECT_IDENTIFIER:
        return objectIdValue(obj.type, obj.instance);
      case PROPERTY.OBJECT_NAME:
        return charValue(obj.kind === 'device' ? options.deviceName : obj.name);
      case PROPERTY.OBJECT_TYPE:
        return enumValue(obj.type);
      case PROPERTY.DESCRIPTION:
        return charValue(obj.description);
      case PROPERTY.PRESENT_VALUE:
        return objectPresentValue(obj);
      case PROPERTY.STATUS_FLAGS:
        return bitStringValue(4, 0);
      case PROPERTY.EVENT_STATE:
        return enumValue(bacnetEnum.EventState.NORMAL);
      case PROPERTY.RELIABILITY:
        return enumValue(bacnetEnum.Reliability.NO_FAULT_DETECTED);
      case PROPERTY.OUT_OF_SERVICE:
        return boolValue(false);
      case PROPERTY.UNITS:
        return enumValue(bacnetEnum.EngineeringUnits.NO_UNITS || 95);
      case PROPERTY.VENDOR_NAME:
        return charValue('Mainting');
      case PROPERTY.VENDOR_IDENTIFIER:
        return unsignedValue(options.vendorId);
      case PROPERTY.MODEL_NAME:
        return charValue('Risco Gateway Modbus/BACnet');
      case PROPERTY.FIRMWARE_REVISION:
        return charValue('0.4.2');
      case PROPERTY.SYSTEM_STATUS:
        return enumValue(bacnetEnum.DeviceStatus.OPERATIONAL);
      case PROPERTY.PROTOCOL_VERSION:
        return unsignedValue(1);
      case PROPERTY.PROTOCOL_REVISION:
        return unsignedValue(14);
      case PROPERTY.SEGMENTATION_SUPPORTED:
        return enumValue(bacnetEnum.Segmentation.NO_SEGMENTATION);
      case PROPERTY.OBJECT_LIST: {
        const refs = objectList().map((item) => ({ type: item.type, instance: item.instance }));
        if (property.index === 0) return unsignedValue(refs.length);
        if (property.index && property.index !== ASN1_ARRAY_ALL) {
          const item = refs[property.index - 1];
          if (!item) return undefined;
          return objectIdValue(item.type, item.instance);
        }
        return refs.slice(0, 64).map((item) => ({ type: TAG.OBJECTIDENTIFIER, value: item }));
      }
      default:
        return undefined;
    }
  };

  client.on('listening', () => {
    status.running = true;
  });

  client.on('error', (error: Error) => {
    status.lastError = error.message;
    hooks.onError?.(error.message);
  });

  client.on('whoIs', (msg: any) => {
    hooks.onWhoIs?.();
    const low = msg.payload?.lowLimit;
    const high = msg.payload?.highLimit;
    const inRange = (low === undefined || options.deviceId >= low) && (high === undefined || options.deviceId <= high);
    if (inRange) {
      client.iAmResponse(msg.header?.sender || null, options.deviceId, bacnetEnum.Segmentation.NO_SEGMENTATION, options.vendorId);
    }
  });

  client.on('readProperty', (msg: any) => {
    hooks.onRead?.();
    const obj = findObject(msg.payload.objectId);
    if (!obj) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.OBJECT, bacnetEnum.ErrorCode.UNKNOWN_OBJECT);
      return;
    }
    const values = propertyValues(obj, msg.payload.property);
    if (!values) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.PROPERTY, bacnetEnum.ErrorCode.UNKNOWN_PROPERTY);
      return;
    }
    client.readPropertyResponse(msg.header.sender, msg.invokeId, msg.payload.objectId, msg.payload.property, values);
  });

  client.on('writeProperty', async (msg: any) => {
    hooks.onWrite?.();
    if (!options.allowWrite) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.PROPERTY, bacnetEnum.ErrorCode.WRITE_ACCESS_DENIED);
      return;
    }
    const obj = findObject(msg.payload.objectId);
    if (!obj || (obj.kind !== 'partition-state' && obj.kind !== 'zone-state')) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.OBJECT, bacnetEnum.ErrorCode.UNKNOWN_OBJECT);
      return;
    }
    if (msg.payload.value?.property?.id !== PROPERTY.PRESENT_VALUE) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.PROPERTY, bacnetEnum.ErrorCode.UNKNOWN_PROPERTY);
      return;
    }
    const value = Number(msg.payload.value?.value?.[0]?.value);
    if (!Number.isFinite(value)) {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.PROPERTY, bacnetEnum.ErrorCode.VALUE_OUT_OF_RANGE || bacnetEnum.ErrorCode.WRITE_ACCESS_DENIED);
      return;
    }
    const ok = await hooks.onWriteValue?.({ kind: obj.kind, instance: obj.instance, value });
    if (ok) {
      client.simpleAckResponse(msg.header.sender, msg.service, msg.invokeId);
    } else {
      client.errorResponse(msg.header.sender, msg.service, msg.invokeId, bacnetEnum.ErrorClass.PROPERTY, bacnetEnum.ErrorCode.VALUE_OUT_OF_RANGE || bacnetEnum.ErrorCode.WRITE_ACCESS_DENIED);
    }
  });

  return {
    status: () => status,
    map: () => buildBacnetMapSummary(options, state),
    stop: () => {
      status.running = false;
      client?.close?.();
    },
  };
}
