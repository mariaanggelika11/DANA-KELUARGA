export type Member = {
  family?: { id: string; name: string; code: string };
  id: string;
  role: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    systemRole: string;
  };
};
export type Family = { id: string; name: string; code: string };
