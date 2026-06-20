type RoleBadgeProps = {
  role: string;
  isOwnerAdmin?: boolean;
  compact?: boolean;
};

function roleLabel(role: string, isOwnerAdmin?: boolean) {
  if (isOwnerAdmin) return 'Owner Admin';
  if (role === 'Maintenance Tech 3') return 'Tech 3';
  if (role === 'Maintenance Tech 2') return 'Tech 2';
  if (role === 'Maintenance Tech 1') return 'Tech 1';
  return role;
}

function roleClass(role: string, isOwnerAdmin?: boolean) {
  if (isOwnerAdmin) return 'owner';
  if (role === 'Admin') return 'admin';
  if (role === 'Manager') return 'manager';
  return 'tech';
}

export function RoleBadge({ role, isOwnerAdmin, compact }: RoleBadgeProps) {
  return (
    <span className={`role-badge ${roleClass(role, isOwnerAdmin)}${compact ? ' compact' : ''}`}>
      <span className="role-badge-mark" aria-hidden="true">{isOwnerAdmin ? 'OA' : roleLabel(role, false).slice(0, 1)}</span>
      {roleLabel(role, isOwnerAdmin)}
    </span>
  );
}
