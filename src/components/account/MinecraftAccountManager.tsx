"use client";

import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import type { MinecraftAccount } from "../../types/minecraft";
import { DropdownHeader } from "../ui/dropdown/DropdownHeader";
import { DropdownFooter } from "../ui/dropdown/DropdownFooter";
import { DropdownDivider } from "../ui/dropdown/DropdownDivider";
import { StatusMessage } from "../ui/StatusMessage";
import { useRef, useState } from "react";
import { gsap } from "gsap";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";

interface MinecraftAccountManagerProps {
  onClose: () => void;
  isInDropdown?: boolean;
}

export function MinecraftAccountManager({
  onClose,
  isInDropdown,
}: MinecraftAccountManagerProps) {
  const {
    accounts,
    isLoading,
    error,
    addAccount,
    removeAccount,
    setActiveAccount,
  } = useMinecraftAuthStore();

  const handleAddAccount = async () => {
    try {
      await addAccount();
    } catch (err) {
      console.error("Error adding account:", err);
    }
  };

  const handleSetActive = async (accountId: string) => {
    try {
      await setActiveAccount(accountId);
    } catch (err) {
      console.error("Error setting active account:", err);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    try {
      await removeAccount(accountId);
    } catch (err) {
      console.error("Error removing account:", err);
    }
  };

  if (isInDropdown) {
    return (
      <div className="flex flex-col max-h-[400px]">
        <DropdownHeader title="minecraft accounts">
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </DropdownHeader>

        <div className="overflow-y-auto custom-scrollbar max-h-[300px]">
          {isLoading && accounts.length === 0 ? (
            <div className="py-3 px-3 text-center">
              <Icon
                icon="solar:spinner-bold"
                className="w-5 h-5 animate-spin mx-auto text-white/70"
              />
              <p className="mt-1 text-white/70 text-sm font-minecraft-ten">Loading accounts...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-4 px-3 text-center">
              <Icon
                icon="solar:user-cross-bold"
                className="w-6 h-6 mx-auto text-white/50 mb-1"
              />
              <p className="text-white/70 text-sm font-minecraft-ten">No accounts found</p>
              <p className="mt-1 text-white/50 text-[0.6em] font-minecraft-ten">
                Add a Minecraft account to get started
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {accounts.map((account) => (
                <AccountItem
                  key={account.id}
                  account={account}
                  onSetActive={handleSetActive}
                  onRemoveAccount={handleRemoveAccount}
                  isLoading={isLoading}
                  isDropdownItem
                />
              ))}
            </div>
          )}
        </div>

        <DropdownDivider />

        <DropdownFooter>
          <Button
            variant="default"
            onClick={handleAddAccount}
            disabled={isLoading}
            icon={<Icon icon="solar:add-circle-bold" className="w-3 h-3" />}
            size="sm"
            className="w-full"
          >
            {isLoading ? (
              <>
                <Icon
                  icon="solar:spinner-bold"
                  className="w-3 h-3 animate-spin"
                />
                <span className="ml-1">Processing...</span>
              </>
            ) : (
              "Add Account"
            )}
          </Button>
        </DropdownFooter>
      </div>
    );
  }

  return (
    <Modal title="minecraft account manager" onClose={onClose} width="lg">
      <div className="p-6">
        {error && <StatusMessage type="error" message={error} />}

        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-minecraft text-white mb-5 lowercase select-none">
              manage minecraft accounts
            </h3>
            <p className="text-xl text-white/70 mb-6 font-minecraft tracking-wide select-none">
              Add, remove, or set active Minecraft accounts for launching the
              game.
            </p>
          </div>

          <div className="bg-black/30 backdrop-blur-md border-2 border-white/20 p-5 rounded-md">
            <h3 className="text-2xl text-white font-medium mb-3 select-none">
              Your Accounts:
            </h3>

            <div className="space-y-3 max-h-[40vh] overflow-y-auto custom-scrollbar">
              {isLoading && accounts.length === 0 ? (
                <div className="py-4 text-center">
                  <Icon
                    icon="solar:spinner-bold"
                    className="w-8 h-8 animate-spin mx-auto text-white/70"
                  />
                  <p className="mt-2 text-white/70 text-xl">
                    Loading accounts...
                  </p>
                </div>
              ) : accounts.length === 0 ? (
                <div className="py-6 text-center">
                  <Icon
                    icon="solar:user-cross-bold"
                    className="w-12 h-12 mx-auto text-white/50 mb-3"
                  />
                  <p className="text-white/70 text-xl">No accounts found</p>
                  <p className="mt-1 text-white/50 text-lg">
                    Add a Minecraft account to get started
                  </p>
                </div>
              ) : (
                accounts.map((account) => (
                  <AccountItem
                    key={account.id}
                    account={account}
                    onSetActive={handleSetActive}
                    onRemoveAccount={handleRemoveAccount}
                    isLoading={isLoading}
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="success"
              onClick={handleAddAccount}
              disabled={isLoading}
              icon={<Icon icon="solar:add-circle-bold" className="w-5 h-5" />}
              size="lg"
            >
              {isLoading ? (
                <>
                  <Icon
                    icon="solar:spinner-bold"
                    className="w-5 h-5 animate-spin"
                  />
                  <span className="ml-2">Processing...</span>
                </>
              ) : (
                "Add Minecraft Account"
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface AccountItemProps {
  account: MinecraftAccount;
  onSetActive: (accountId: string) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  isLoading: boolean;
  isDropdownItem?: boolean;
}

function AccountItem({
  account,
  onSetActive,
  onRemoveAccount,
  isLoading,
  isDropdownItem,
}: AccountItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  // Avatar sizes in pixels
  const avatarSizePx = isDropdownItem ? 32 : 40;
  const avatarUrl = useCrafatarAvatar({
    uuid: account.id,
    size: avatarSizePx,
    overlay: true,
  });

  const handleAccountClick = () => {
    if (
      account.active ||
      isLoading ||
      isActivating ||
      isRemoving ||
      !itemRef.current
    )
      return;

    setIsActivating(true);
    gsap.to(itemRef.current, {
      scale: 0.97,
      duration: 0.1,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
      onComplete: () => {
        gsap.set(itemRef.current, { scale: 1 });
        const performSetActive = async () => {
          try {
            await onSetActive(account.id);
          } catch (err) {
            console.error("Error setting account active:", err);
          } finally {
            setIsActivating(false);
          }
        };
        performSetActive();
      },
    });
  };

  const handleRemoveClick = async () => {
    if (isLoading || isActivating || isRemoving) return;

    setIsRemoving(true);
    try {
      await onRemoveAccount(account.id);
    } catch (err) {
      console.error("Error removing account:", err);
      setIsRemoving(false);
    }
  };

  const effectiveIsLoading = isLoading || isActivating || isRemoving;

  return (
    <div
      ref={itemRef}
      className={`flex items-center justify-between rounded-md ${
        account.active ? "bg-white/10" : "bg-black/40 hover:bg-white/5"
      } border border-white/10 hover:border-white/20 transition-colors overflow-hidden ${
        !account.active && !effectiveIsLoading
          ? "cursor-pointer"
          : "cursor-default"
      } ${isActivating ? "opacity-75" : ""}`}
      onClick={!account.active ? handleAccountClick : undefined}
    >
      <div className="flex items-center gap-2 min-w-0 flex-grow p-2">
        <div
          className="relative overflow-hidden border border-white/20 flex items-center justify-center bg-black/50 flex-shrink-0 rounded-sm"
          style={{
            width: isDropdownItem ? '32px' : '40px',
            height: isDropdownItem ? '32px' : '40px',
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl || "/placeholder.svg"}
              alt={`${account.minecraft_username || account.username}'s avatar`}
              className="pixelated"
              style={{
                width: `${avatarSizePx}px`,
                height: `${avatarSizePx}px`,
                objectFit: 'cover',
                display: 'block',
                imageRendering: 'pixelated' as const,
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = "none";
              }}
            />
          ) : (
            <span
              className={`text-white font-minecraft lowercase ${isDropdownItem ? "text-xs" : ""}`}
            >
              {account.minecraft_username?.charAt(0) || "?"}
            </span>
          )}
        </div>
        <div className="min-w-0 flex items-center">
          <h4
            className={`${isDropdownItem ? "text-3xl" : "text-2xl"} text-white font-minecraft truncate`}
            title={account.minecraft_username || account.username}
          >
            {account.minecraft_username || account.username}
          </h4>
          {isActivating && (
            <Icon
              icon="solar:spinner-bold"
              className={`animate-spin ${isDropdownItem ? "w-4 h-4" : "w-5 h-5"} text-white/80 ml-2`}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 p-1">
        {isDropdownItem ? (
          <IconButton
            variant="ghost"
            onClick={handleRemoveClick}
            disabled={effectiveIsLoading}
            shadowDepth="short"
            icon={
              isRemoving ? (
                <Icon
                  icon="solar:spinner-bold"
                  className="w-3 h-3 animate-spin"
                />
              ) : (
                <Icon icon="solar:trash-bin-trash-bold" className="w-3 h-3" />
              )
            }
            size="xs"
            aria-label="Remove Account"
          />
        ) : (
          <Button
            variant="destructive"
            onClick={handleRemoveClick}
            disabled={effectiveIsLoading}
            size="md"
            aria-label="Remove Account"
          >
            {isRemoving ? (
              <>
                <Icon
                  icon="solar:spinner-bold"
                  className="w-5 h-5 animate-spin"
                />
                <span className="ml-2">Removing...</span>
              </>
            ) : (
              <>
                <Icon icon="solar:trash-bin-trash-bold" className="w-5 h-5" />
                <span className="ml-1">Remove</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
