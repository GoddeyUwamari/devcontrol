// Re-export from sonner if available, otherwise stub
export { toast } from 'sonner'
export const useToast = () => ({
  toast: (opts: { title?: string; description?: string; variant?: string }) => {
    console.log(opts.title, opts.description)
  }
})
