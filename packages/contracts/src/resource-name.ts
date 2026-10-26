/** Keep identical to qitu_resource_name_key in database migration 0053. */
export function resourceNameKey(name: string): string {
  return name.replace(/\s+/gu, ' ').trim().replace(/[A-Z]/g, letter => letter.toLowerCase());
}
