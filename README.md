# Painel eleitoral de Cuiabá

Dashboard React + Vite para explorar resultados eleitorais consolidados por bairro. Os dados iniciais são lidos de `src/assets/data/Votacao por Secao Zona Bairro Regiao - Cuiaba 2026 - Consolidado por Bairro.csv`.

## Executar

```sh
npm install
npm run dev
```

`npm run build` gera a versão de produção e `npm run lint` executa o Oxlint.

## Mapa de bairros

O projeto não inclui limites geográficos de bairros. Selecione um bairro na tabela completa; o dashboard consulta o Nominatim/OpenStreetMap pelo polígono e o desenha no Leaflet, enquadrando a geometria automaticamente. A caixa ao lado do mapa permite buscar bairros por nome e filtrar por região. Quando uma região específica está selecionada, o painel exibe os indicadores do arquivo `Consolidado por Regiao.csv`; com **Todas as regiões**, exibe os detalhes do bairro selecionado na tabela. A busca do limite é cancelada quando a seleção muda; falhas ou bairros sem polígono são exibidos no painel.

Também é possível selecionar **Carregar limites** e importar um GeoJSON `FeatureCollection` de `Polygon`/`MultiPolygon` para visualizar vários bairros. O arquivo precisa incluir uma propriedade de texto com os nomes dos bairros; escolha essa propriedade no seletor abaixo do mapa. Os nomes são normalizados para fazer a correspondência com a coluna `Bairro` do CSV. Bairros sem correspondência continuam visíveis, mas ficam sem dados associados.

O mapa base e a busca de limites requerem conexão com a internet. Atribuição do OpenStreetMap é exibida no próprio mapa; use o Nominatim conforme a [política de uso](https://operations.osmfoundation.org/policies/nominatim/).

## CSV de bairros

O dashboard lê os resultados e indicadores de `Consolidado por Bairro.csv`, associa `Diferença` de `Bairros - Principais Reduções Votos.csv` pelo nome normalizado do bairro e mostra um ícone de feira ao lado do bairro selecionado quando o nome aparece em `Bairros - Feiras.csv`. A variação `2026 − 2024` aparece na tabela completa e nos detalhes do bairro selecionado, e também é uma opção de ordenação. Bairros sem correspondência de redução aparecem sem valor (`—`). Valores numéricos no padrão brasileiro (ponto para milhar e vírgula decimal) são tratados durante a leitura.
