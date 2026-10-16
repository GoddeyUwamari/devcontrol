// Re-export from sonner if available, otherwise stub
export { toast } from 'sonner'
export const useToast = () => ({
  // Stub: shows nothing.
  toast: (_opts: { title?: string; description?: string; variant?: string }) => {}
})
