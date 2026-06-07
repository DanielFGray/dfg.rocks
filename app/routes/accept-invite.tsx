import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/accept-invite')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/accept-invite"!</div>
}
