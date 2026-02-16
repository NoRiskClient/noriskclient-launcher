"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Icon } from "@iconify/react";
import { ModPlatform } from "../../types/unified";

interface ModDetailDescriptionProps {
  body: string;
  source: ModPlatform;
}

// HTML sanitizer for CurseForge HTML content
const sanitizeHtml = (html: string) => {
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<style[^>]*>.*?<\/style>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+="[^"]*"/gi, "");
};

export function ModDetailDescription({ body, source }: ModDetailDescriptionProps) {
  const { t } = useTranslation();

  if (!body || body.trim().length === 0) {
    return (
      <div className="bg-black/20 rounded-lg p-4 border border-white/10">
        <h2 className="text-lg font-minecraft-ten text-white flex items-center gap-2 mb-4 normal-case">
          <Icon icon="solar:document-text-bold" className="w-5 h-5" />
          {t('mod_detail.description')}
        </h2>
        <p className="text-white/50 font-minecraft-ten text-center py-8">
          {t('mod_detail.no_description')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-black/20 rounded-lg p-4 border border-white/10">
      <h2 className="text-lg font-minecraft-ten text-white flex items-center gap-2 mb-4 normal-case">
        <Icon icon="solar:document-text-bold" className="w-5 h-5" />
        {t('mod_detail.description')}
      </h2>

      <div>
        {source === ModPlatform.CurseForge ? (
          // Render HTML for CurseForge (sanitized)
          <div
            className="prose prose-invert prose-sm max-w-none font-sans
              [&_*]:font-sans
              [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:first:mt-0 [&_h1]:normal-case [&_h1]:tracking-normal
              [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:normal-case [&_h2]:tracking-normal
              [&_h3]:text-base [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:normal-case [&_h3]:tracking-normal
              [&_h4]:text-sm [&_h4]:font-bold [&_h4]:mb-2 [&_h4]:mt-3 [&_h4]:normal-case [&_h4]:tracking-normal
              [&_h5]:text-sm [&_h5]:font-bold [&_h5]:mb-2 [&_h5]:mt-3 [&_h5]:normal-case [&_h5]:tracking-normal
              [&_h6]:text-sm [&_h6]:font-bold [&_h6]:mb-2 [&_h6]:mt-3 [&_h6]:normal-case [&_h6]:tracking-normal
              [&_p]:text-sm [&_p]:text-white/90 [&_p]:mb-3 [&_p]:leading-relaxed
              [&_summary]:cursor-pointer
              [&_ul]:list-disc [&_ul]:list-inside [&_ul]:text-sm [&_ul]:text-white/90 [&_ul]:mb-3 [&_ul]:space-y-1 [&_ul]:ml-4
              [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:text-sm [&_ol]:text-white/90 [&_ol]:mb-3 [&_ol]:space-y-1 [&_ol]:ml-4
              [&_li]:leading-relaxed
              [&_strong]:font-bold [&_strong]:text-white
              [&_em]:italic [&_em]:text-white/80
              [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-white/90
              [&_pre]:bg-black/30 [&_pre]:p-3 [&_pre]:rounded [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-white/90 [&_pre]:overflow-x-auto [&_pre]:mb-3
              [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/70 [&_blockquote]:my-3
              [&_a]:text-accent [&_a]:hover:text-accent/80 [&_a]:underline
              [&_img]:inline [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-1
              [&_hr]:border-white/20 [&_hr]:my-6
              [&_table]:w-full [&_table]:border-collapse [&_table]:mb-3
              [&_th]:bg-black/30 [&_th]:p-2 [&_th]:border [&_th]:border-white/20 [&_th]:text-left
              [&_td]:p-2 [&_td]:border [&_td]:border-white/20"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
          />
        ) : (
          // Render Markdown for Modrinth (with HTML support via rehype-raw)
          <div className="prose prose-invert prose-sm max-w-none font-sans">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-white mb-3 mt-6 first:mt-0 font-sans normal-case tracking-normal">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-bold text-white mb-2 mt-5 font-sans normal-case tracking-normal">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-bold text-white mb-2 mt-4 font-sans normal-case tracking-normal">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-sm font-bold text-white mb-2 mt-3 font-sans normal-case tracking-normal">
                    {children}
                  </h4>
                ),
                h5: ({ children }) => (
                  <h5 className="text-sm font-bold text-white mb-2 mt-3 font-sans normal-case tracking-normal">
                    {children}
                  </h5>
                ),
                h6: ({ children }) => (
                  <h6 className="text-sm font-bold text-white mb-2 mt-3 font-sans normal-case tracking-normal">
                    {children}
                  </h6>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-white/90 mb-3 leading-relaxed font-sans">
                    {children}
                  </p>
                ),
               summary: ({ children }) => (
                  <summary className="cursor-pointer" style={{width:'fit-content'}}>
                    {children}
                  </summary>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside text-sm text-white/90 mb-3 space-y-1 ml-4 font-sans">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside text-sm text-white/90 mb-3 space-y-1 ml-4 font-sans">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="leading-relaxed font-sans">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-bold text-white">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-white/80">{children}</em>
                ),
                code: ({ children, className }) => {
                  // Check if it's inline code or a code block
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <code className="text-xs font-mono text-white/90">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className="bg-black/30 px-1 py-0.5 rounded text-xs font-mono text-white/90">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-black/30 p-3 rounded text-xs font-mono text-white/90 overflow-x-auto mb-3">
                    {children}
                  </pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-accent pl-4 italic text-white/70 my-3 font-sans">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-accent hover:text-accent/80 underline font-sans"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                img: ({ src, alt }) => (
                  <img
                    src={src}
                    alt={alt}
                    className="inline max-w-full h-auto rounded-lg my-1"
                    loading="lazy"
                  />
                ),
                hr: () => <hr className="border-white/20 my-6" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full border-collapse font-sans text-sm">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-black/30">{children}</thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => (
                  <tr className="border-b border-white/10 hover:bg-white/5">
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th className="p-2 border border-white/20 text-left font-semibold text-white/90">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="p-2 border border-white/20 text-white/80">
                    {children}
                  </td>
                ),
              }}
            >
              {body}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
