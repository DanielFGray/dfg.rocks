import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/assignments/$materialId')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authed/assignments/$materialId"!</div>
}
