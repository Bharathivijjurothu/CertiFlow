import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../types/express';

export async function loginUser(email: string, plainPassword: string) {
  if (!email || !plainPassword) {
    throw new Error('Email and password are required');
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() }
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  const authUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    districtId: user.districtId,
    trainingCentreId: user.trainingCentreId
  };

  const token = jwt.sign(authUser, config.jwtSecret, {
    expiresIn: '24h'
  });

  return {
    token,
    user: authUser
  };
}
