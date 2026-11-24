/** Leaves for GitHub in this same tab (sessionStorage is per tab; never window.open). Its own module so tests can stand in for it. */
export function goToGitHub(url: string): void {
  window.location.assign(url)
}
