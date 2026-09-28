"use client";
import { Buildings } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  slug: string;
  size?: "sm" | "md";
}

export function TenantBadge({ name, slug, size = "md" }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "inline-flex cursor-default items-center gap-1 font-normal",
            size === "sm" && "h-4 px-1.5 text-[10px]",
            size === "md" && "h-5 px-2 text-xs",
          )}
        >
          <Buildings
            size={size === "sm" ? 10 : 12}
            weight="duotone"
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
          <span className="max-w-[120px] truncate">{name}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {slug}
      </TooltipContent>
    </Tooltip>
  );
}
