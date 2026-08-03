import type { ReactNode } from 'react';

export type PermissionKey=
  |'inventory.view'|'inventory.create'|'inventory.edit'|'inventory.delete'|'inventory.import'|'inventory.export'|'inventory.requisition_stage'
  |'requisitions.view'|'requisitions.create'|'requisitions.edit'|'requisitions.mark_ordered'|'requisitions.mark_received'|'requisitions.cancel'|'requisitions.delete'|'requisitions.manage_batches'|'requisitions.print_download'
  |'machine.view'|'machine.create'|'machine.edit'|'machine.delete'|'machine.pm_manage'|'machine.documents_upload'|'machine.documents_manage'|'machine.notes_manage'|'machine.import_export'
  |'equipment.view'|'equipment.create'|'equipment.edit'|'equipment.delete'|'equipment.pm_manage'|'equipment.documents_upload'|'equipment.documents_manage'|'equipment.notes_manage'|'equipment.import_export'
  |'facility.view'|'facility.create'|'facility.edit'|'facility.delete'|'facility.folders_manage'|'facility.upload'|'facility.rename_move'|'facility.content_delete'|'facility.recovery_export'
  |'vendors.view'|'vendors.create'|'vendors.edit'|'vendors.delete'|'vendors.import_export'
  |'history.view'|'history.export';

export function hasPermission(effectivePermissions:readonly string[]|undefined,permission:PermissionKey,fallback=false){
  return effectivePermissions?effectivePermissions.includes(permission):fallback;
}

export function MccPermissionGate({effectivePermissions,permission,fallback=null,children}:{effectivePermissions:readonly string[]|undefined;permission:PermissionKey;fallback?:ReactNode;children:ReactNode}){
  return hasPermission(effectivePermissions,permission)?children:fallback;
}
