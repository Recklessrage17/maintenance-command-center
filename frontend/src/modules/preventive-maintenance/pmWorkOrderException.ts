export const PM_WORK_ORDER_EXCEPTION_LABEL = 'Not required — machine not scheduled / not running';

export function pmWorkOrderDisplay(record: {workOrderNumber: string; machineNotScheduledOrRunning?: boolean}) {
  return record.machineNotScheduledOrRunning
    ? `${PM_WORK_ORDER_EXCEPTION_LABEL}${record.workOrderNumber ? ` (${record.workOrderNumber})` : ''}`
    : record.workOrderNumber;
}
