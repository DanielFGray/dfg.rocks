import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/courses/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authed/courses/$id"!</div>
}
