import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/assignments/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authed/assignments/"!</div>
}
