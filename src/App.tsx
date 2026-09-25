import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />}>
            <Route index element={null} />
            <Route path="music" element={null} />
            <Route path="liked" element={null} />
            <Route path="recent" element={null} />
            <Route path="playlists" element={null} />
            <Route path="playlists/:playlistId" element={null} />
            <Route path="artists" element={null} />
            <Route path="artists/:artistKey" element={null} />
            <Route path="albums" element={null} />
            <Route path="albums/:artistKey/:albumKey" element={null} />
            <Route path="settings" element={null} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
