import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

interface RouterOptions extends RenderOptions {
  /** The URL path to navigate to, e.g. "/jobs/abc-123" */
  route?: string;
  /** The route pattern, e.g. "/jobs/:id" */
  routePath?: string;
}

/**
 * Render a component inside a MemoryRouter with route params.
 * Use this for components/pages that call useParams() or <Link>.
 */
export function renderWithRouter(
  ui: ReactElement,
  { route = '/', routePath = '/', ...renderOptions }: RouterOptions = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={routePath} element={ui} />
      </Routes>
    </MemoryRouter>,
    renderOptions,
  );
}
