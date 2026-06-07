import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/students/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authed/students/$id"!</div>
}
