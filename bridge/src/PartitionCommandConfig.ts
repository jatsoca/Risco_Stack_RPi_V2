export const PARTITION_COMMAND_STRATEGIES = [
  'equals_star_decimal',
  'colon_decimal',
  'colon_zero_pad_3',
  'equals_zero_pad_3',
  'equals_hex',
  'equals_hex_zero_pad_2',
  'p_suffix_equals_plain',
  'p_suffix_colon_decimal',
  'p_suffix_colon_zero_pad_3',
  'p_suffix_equals_zero_pad_3',
  'p_suffix_equals_hex',
  'p_suffix_equals_hex_zero_pad_2',
  'equals_plain',
] as const;

export type PartitionCommandStrategy = typeof PARTITION_COMMAND_STRATEGIES[number];

export const PARTITION_COMMAND_MODES = ['fixed', 'probe'] as const;
export type PartitionCommandMode = typeof PARTITION_COMMAND_MODES[number];

export interface PartitionCommandOptions {
  partitionCommandMode?: PartitionCommandMode;
  partitionCommandStrategy?: PartitionCommandStrategy;
  partitionCommandProbeOrder?: PartitionCommandStrategy[] | string;
}

export interface PartitionCommandConfig {
  mode: PartitionCommandMode;
  strategy: PartitionCommandStrategy;
  probeOrder: PartitionCommandStrategy[];
}

export type PartitionCommandVerb = 'ARM' | 'STAY' | 'DISARM';

export const DEFAULT_PARTITION_COMMAND_STRATEGY: PartitionCommandStrategy = 'equals_star_decimal';
export const DEFAULT_PARTITION_COMMAND_PROBE_ORDER: PartitionCommandStrategy[] = [
  'equals_star_decimal',
  'colon_decimal',
  'colon_zero_pad_3',
  'equals_zero_pad_3',
  'equals_hex_zero_pad_2',
  'p_suffix_equals_plain',
  'p_suffix_equals_zero_pad_3',
  'p_suffix_colon_decimal',
  'p_suffix_colon_zero_pad_3',
  'p_suffix_equals_hex_zero_pad_2',
  'equals_plain',
];

const strategySet = new Set<string>(PARTITION_COMMAND_STRATEGIES);

export const isPartitionCommandStrategy = (value: unknown): value is PartitionCommandStrategy => (
  typeof value === 'string' && strategySet.has(value)
);

export const normalizePartitionCommandMode = (value: unknown): PartitionCommandMode => (
  value === 'probe' ? 'probe' : 'fixed'
);

export const normalizePartitionCommandStrategy = (value: unknown): PartitionCommandStrategy => (
  isPartitionCommandStrategy(value) ? value : DEFAULT_PARTITION_COMMAND_STRATEGY
);

export const normalizePartitionCommandProbeOrder = (value: unknown): PartitionCommandStrategy[] => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const parsed = rawValues
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter((item): item is PartitionCommandStrategy => isPartitionCommandStrategy(item));

  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : [...DEFAULT_PARTITION_COMMAND_PROBE_ORDER];
};

export const normalizePartitionCommandConfig = (
  options: PartitionCommandOptions | undefined,
): PartitionCommandConfig => {
  const strategy = normalizePartitionCommandStrategy(options?.partitionCommandStrategy);
  const mode = normalizePartitionCommandMode(options?.partitionCommandMode);
  const probeOrder = normalizePartitionCommandProbeOrder(options?.partitionCommandProbeOrder);
  return {
    mode,
    strategy,
    probeOrder,
  };
};

export const buildPartitionCommandFromStrategy = (
  command: PartitionCommandVerb,
  partitionId: number,
  strategy: PartitionCommandStrategy,
): string => {
  const commandToken = (() => {
    switch (strategy) {
      case 'p_suffix_equals_plain':
      case 'p_suffix_colon_decimal':
      case 'p_suffix_colon_zero_pad_3':
      case 'p_suffix_equals_zero_pad_3':
      case 'p_suffix_equals_hex':
      case 'p_suffix_equals_hex_zero_pad_2':
        if (command === 'ARM') return 'ARMP';
        if (command === 'DISARM') return 'DISARMP';
        return command;
      default:
        return command;
    }
  })();

  const decimal = `${partitionId}`;
  const decimalPadded3 = decimal.padStart(3, '0');
  const hex = partitionId.toString(16).toUpperCase();
  const hexPadded2 = hex.padStart(2, '0');

  switch (strategy) {
    case 'equals_star_decimal':
      return `${commandToken}=*${decimal}`;
    case 'colon_decimal':
      return `${commandToken}:${decimal}`;
    case 'colon_zero_pad_3':
      return `${commandToken}:${decimalPadded3}`;
    case 'equals_zero_pad_3':
      return `${commandToken}=${decimalPadded3}`;
    case 'equals_hex':
      return `${commandToken}=${hex}`;
    case 'equals_hex_zero_pad_2':
      return `${commandToken}=${hexPadded2}`;
    case 'p_suffix_equals_plain':
      return `${commandToken}=${decimal}`;
    case 'p_suffix_colon_decimal':
      return `${commandToken}:${decimal}`;
    case 'p_suffix_colon_zero_pad_3':
      return `${commandToken}:${decimalPadded3}`;
    case 'p_suffix_equals_zero_pad_3':
      return `${commandToken}=${decimalPadded3}`;
    case 'p_suffix_equals_hex':
      return `${commandToken}=${hex}`;
    case 'p_suffix_equals_hex_zero_pad_2':
      return `${commandToken}=${hexPadded2}`;
    case 'equals_plain':
    default:
      return `${commandToken}=${decimal}`;
  }
};
