Mix.install([{:solid, "== 1.2.2"}])

[template_path, output_dir | options] = System.argv()
unless options in [[], ["--personalized"]], do: raise("Usage: verify-keila-liquid.exs TEMPLATE_HTML OUTPUT_DIRECTORY [--personalized]")
source = File.read!(template_path)
{:ok, template} = Solid.parse(source)
File.mkdir_p!(output_dir)

cases = [{"zero", 0, :nil}, {"one", 1, :nil}, {"three", 3, :nil}, {"empty-image", 3, :empty}, {"missing-image", 3, :missing}]
contacts =
  if options == ["--personalized"] do
    [
      {"named", %{"first_name" => "Jane"}, "Hi Jane,"},
      {"missing-name", %{}, "Hi there,"},
      {"nil-name", %{"first_name" => nil}, "Hi there,"},
      {"empty-name", %{"first_name" => ""}, "Hi there,"},
      {"whitespace-name", %{"first_name" => "  "}, "Hi there,"},
      {"padded-name", %{"first_name" => "  Jane  "}, "Hi Jane,"},
      {"unicode-name", %{"first_name" => "Zoë"}, "Hi Zoë,"},
      {"escaped-name", %{"first_name" => "A<B>"}, "Hi A&lt;B&gt;,"}
    ]
  else
    [{"default", %{}, nil}]
  end

for {case_name, count, absent} <- cases, {contact_name, contact, greeting} <- contacts do
  name = "#{case_name}-#{contact_name}"
  articles =
    for n <- 1..max(count, 1), count > 0 do
      article = %{
        "title" => "Fixture Article #{n}",
        "body" => "Fixture body #{n} <keep> & quotes",
        "image_url" => if(rem(n, 2) == 1, do: "https://example.invalid/image-#{n}.png", else: nil),
        "image_alt" => "Fixture image #{n}",
        "url" => "https://example.invalid/article-#{n}"
      }

      case {rem(n, 2), absent} do
        {0, :empty} -> Map.put(article, "image_url", "")
        {0, :missing} -> Map.delete(article, "image_url")
        _ -> article
      end
    end

  assigns = %{
    "campaign" => %{
      "id" => "fixture-campaign", "subject" => "Fixture issue", "preview_text" => "Fixture preheader",
      "data" => %{
        "articles" => articles, "issue_date" => "Fixture date",
        "action_url" => "https://example.invalid/action", "action_label" => "Fixture action"
      }
    },
    "unsubscribe_link" => "https://example.invalid/unsubscribe",
    "contact" => contact
  }

  {:ok, rendered, []} = Solid.render(template, assigns)
  html = to_string(rendered)
  File.write!(Path.join(output_dir, "#{name}.html"), html)
  titles = Regex.scan(~r/Fixture Article \d+/, html) |> Enum.map(&hd/1)
  expected_titles = Enum.map(articles, &Map.fetch!(&1, "title"))
  if titles != expected_titles, do: raise("#{name}: article count or order differs")
  if Regex.match?(~r/<img\b[^>]*\bsrc\s*=\s*["']\s*["']/i, html), do: raise("#{name}: empty image source")
  if Regex.match?(~r/\{\{|\{%/, html), do: raise("#{name}: unresolved Liquid")
  if String.contains?(html, "<keep>"), do: raise("#{name}: article body is unescaped")
  if greeting && !String.contains?(html, greeting), do: raise("#{name}: personalized greeting or fallback differs")
  if greeting && String.contains?(html, "A<B>"), do: raise("#{name}: recipient name is unescaped")

  for {article, i} <- Enum.with_index(articles, 1) do
    unless String.contains?(html, "Fixture body #{i} &lt;keep&gt; &amp; quotes"), do: raise("#{name}: article body missing or changed")
    image = Map.get(article, "image_url")
    if image && image != "" do
      unless String.contains?(html, "src=\"#{image}\""), do: raise("#{name}: article image missing")
    end
  end

  image_count = length(Regex.scan(~r/<img\b[^>]*\bsrc="https:\/\/example\.invalid\/image-\d+\.png"/i, html))
  expected_images = Enum.count(articles, &(Map.get(&1, "image_url") not in [nil, ""]))
  if image_count != expected_images, do: raise("#{name}: unexpected article images")
  IO.puts("PASS #{name}: #{count} articles, #{image_count} article images; escaped bodies and no unresolved Liquid")
end
