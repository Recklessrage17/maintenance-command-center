export const PM_UPDATED_EVENT = 'mcc:preventive-maintenance-updated';

export function notifyPmUpdated() {
  window.dispatchEvent(new CustomEvent(PM_UPDATED_EVENT));
}
