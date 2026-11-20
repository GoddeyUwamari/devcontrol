import { redirect } from 'next/navigation'

/**
 * /deployments/new is kept as a route, but it has no form of its own: the
 * Deployments page's "Record a deployment" form is the only one that creates
 * deployment rows. ?record=1 opens it.
 */
export default function NewDeploymentPage(): never {
  redirect('/deployments?record=1')
}
