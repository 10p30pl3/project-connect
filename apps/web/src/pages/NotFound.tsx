import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';

export function NotFoundPage() {
  return (
    <Empty
      title="Página não encontrada"
      action={
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
          Voltar para a visão geral
        </Link>
      }
    >
      O endereço acessado não existe ou foi movido.
    </Empty>
  );
}
