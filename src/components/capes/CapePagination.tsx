"use client";
import { useTranslation } from "react-i18next";
import type { PaginationInfo } from "../../types/noriskCapes";
import { Button } from "../ui/buttons/Button";
import { Card } from "../ui/Card";

interface CapePaginationProps {
  paginationInfo: PaginationInfo;
  onPageChange: (newPage: number) => void;
}

export function CapePagination({
  paginationInfo,
  onPageChange,
}: CapePaginationProps) {
  const { t } = useTranslation();
  const { currentPage, totalPages, totalItems } = paginationInfo;

  if (totalPages <= 1) {
    return null; // Don't render pagination if there's only one page or no items
  }

  const handlePrevious = () => {
    if (currentPage > 0) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      onPageChange(currentPage + 1);
    }
  };

  return (
    <Card
      className="flex items-center justify-between px-4 py-2 mt-auto"
      variant="flat"
    >
      <p className="font-minecraft lowercase text-sm text-white/60">
        {t('capes.pageInfo', { current: currentPage + 1, total: totalPages })}
        <span className="text-white/40 text-xs ml-1">({totalItems})</span>
      </p>
      <div className="flex items-center space-x-1.5">
        <Button
          onClick={handlePrevious}
          disabled={currentPage === 0}
          variant="flat-secondary"
          size="xs"
          className="font-minecraft lowercase text-sm px-2 py-0.5"
        >
          &lt;
        </Button>
        <Button
          onClick={handleNext}
          disabled={currentPage >= totalPages - 1}
          variant="flat-secondary"
          size="xs"
          className="font-minecraft lowercase text-sm px-2 py-0.5"
        >
          &gt;
        </Button>
      </div>
    </Card>
  );
}
