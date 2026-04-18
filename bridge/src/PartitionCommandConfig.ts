export const PARTITION_COMMAND_STRATEGIES = [
  'p_suffix_equals_plain',
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

export const DEFAULT_PARTITION_COMMAND_STRATEGY: PartitionCommandStrategy = 'p_suffix_equals_plain';
export const DEFAULT_PARTITION_COMMAND_PROBE_ORDER: PartitionCommandStrategy[] = [
  'p_suffix_equals_plain',
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
  const commandToken = command === 'ARM'
    ? 'ARMP'
    : command === 'DISARM'
      ? 'DISARMP'
      : command;
  const decimal = `${partitionId}`;

  switch (strategy) {
    case 'p_suffix_equals_plain':
    default:
      return `${commandToken}=${decimal}`;
  }
};
